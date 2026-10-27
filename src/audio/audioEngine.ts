import * as Tone from 'tone'
import { toneName } from '../music/theory'
import { defaults, effective, type Effective, type Params } from './sound'

export type InstrumentId = 'piano' | 'epiano' | 'strings' | 'synth'
export const INSTRUMENTS: { id: InstrumentId; label: string }[] = [
  { id: 'piano', label: 'Grand piano' },
  { id: 'epiano', label: 'Electric piano' },
  { id: 'strings', label: 'Soft strings' },
  { id: 'synth', label: 'Synth lead' },
]

type Voice = Tone.Sampler | Tone.PolySynth
const RAMP = 0.04 // s: long enough to avoid zipper noise from 7-bit knob steps, short enough to feel direct

/** The effects chain. Keys: input → [active stages of] drive → filter → EQ → chorus → phaser → tremolo → keys vol; drums join after it. */
interface Chain {
  input: Tone.Gain; tremoloGain: Tone.Gain
  drive: Tone.Distortion; filter: Tone.Filter; eq: Tone.EQ3; chorus: Tone.Chorus; phaser: Tone.Phaser; tremolo: Tone.Tremolo
  keysVol: Tone.Volume; drumsVol: Tone.Volume; delay: Tone.FeedbackDelay; reverb: Tone.Reverb; widener: Tone.StereoWidener
}

/**
 * One instrument path for live keys and auto-played notes, so both sound identical.
 * Live notes use Tone.immediate(); scheduled notes pass an exact AudioContext time.
 */
class AudioEngine {
  started = false
  pianoLoaded = false
  pianoFailed = false
  /** Last audio error, shown in Settings so a silent device can be diagnosed without dev tools. */
  lastError = ''
  private inst: InstrumentId = 'piano'
  private voices = new Map<InstrumentId, Voice>()
  private sustained = new Set<number>() // released while the pedal was down
  private down = new Set<number>()
  private sustain = false
  private click: Tone.Synth | null = null
  private fallback: Voice | null = null
  private vibrato: Tone.Vibrato | null = null
  private kit: ((time: number, vel: number) => void)[] = []
  private lastHit: number[] = []
  private bendCents = 0
  private chain: Chain | null = null
  private sounds: Partial<Record<InstrumentId, Params>> = {}
  private applied: Partial<Effective> = {}
  private voiceKeys = new WeakMap<Voice, string>()
  private reverbTimer = 0
  private starting: Promise<void> | null = null
  private wired = ''
  private rewireTimer = 0
  private liveVoice = new Map<number, Voice>() // pitch → voice that started it, so the release reaches the same voice
  /** 'interactive' = smallest buffer; 'balanced' trades ~20 ms for fewer crackles. Read once, when audio starts. */
  latencyHint: AudioContextLatencyCategory = 'interactive'
  /** Instrument for auto-played notes when it should differ from the player's (e.g. a backing under a synth lead). */
  backing: InstrumentId | null = null
  /** Arpeggiator and chord memory act on live notes only while this is true (lessons turn it off). */
  performFx = true
  /** Tempo for the arpeggiator and the synced delay. */
  bpm = 100

  get instrument() { return this.inst }
  set instrument(id: InstrumentId) { if (id !== this.inst) { this.inst = id; this.apply() } }

  get ctx() { return Tone.getContext().rawContext as AudioContext }
  now() { return this.ctx.currentTime }
  /**
   * Audio-clock time that was coming out of the speakers at `perfMs` (performance.now() domain).
   * getOutputTimestamp() pairs both clocks in one reading and already includes output latency,
   * so a key press maps to "the moment of music the player heard".
   */
  heard(perfMs: number) {
    const ots = this.ctx.getOutputTimestamp?.()
    if (ots && ots.contextTime && ots.performanceTime) return ots.contextTime + (perfMs - ots.performanceTime) / 1000
    return this.ctx.currentTime - this.outputLatency + (perfMs - performance.now()) / 1000
  }

  /**
   * Must run inside a user gesture (browser autoplay policy). Safe to call repeatedly, also concurrently:
   * the first click often calls it twice at once, which used to build two contexts and two effect chains.
   */
  start() {
    if (this.starting) { this.resume(); return this.starting }
    return (this.starting = this.boot().catch((err) => { this.starting = null; this.lastError = String(err); throw err })) // a failed start can be retried
  }
  /**
   * Ask the browser to run the audio clock. Called from every gesture until it runs: on phones a touch only counts
   * as a gesture when the finger lifts, and a phone can suspend audio again (screen lock, a call).
   */
  resume() { const c = this.ctx; if (c.state !== 'running') void c.resume().catch((err) => { this.lastError = `resume: ${err}` }) }
  /** One line for the status readout: is the clock running, at what rate and latency, and is the piano in. */
  status() {
    if (!this.started) return 'Not started – tap the screen once'
    const c = this.ctx
    const piano = this.pianoFailed ? 'piano samples failed (synth piano)' : this.pianoLoaded ? 'piano loaded' : 'piano loading (synth meanwhile)'
    return `${c.state} · ${Math.round(c.sampleRate / 100) / 10} kHz · ${Math.round(this.outputLatency * 1000)} ms · ${piano}`
  }
  /** True once sound can actually be heard. */
  get running() { return this.started && this.ctx.state === 'running' }
  private async boot() {
    const prev = Tone.getContext()
    // lookAhead 0 because we schedule with explicit times.
    Tone.setContext(new Tone.Context({ latencyHint: this.latencyHint, lookAhead: 0 }))
    void (prev as Tone.Context).close().catch(() => {}) // the default context Tone made before the click; two live contexts compete for the device
    // Build everything before asking to resume, and don't wait for it: if this event was not a gesture the browser
    // accepts (a touch's press-down), resuming waits for the next one, and the instruments must already exist then.
    // Waiting here used to leave the app silent for good on phones.
    this.started = true
    this.click = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 }, volume: -14 }).toDestination()
    this.chain = this.makeChain()
    // Synth sounds go through a vibrato the mod strip controls (depth 0 = no effect).
    this.vibrato = new Tone.Vibrato(5.5, 0).connect(this.chain.input)
    this.voices.set('piano', this.makePiano())
    this.kit = this.makeKit()
    this.apply()
    this.resume()
  }

  private makeChain(): Chain {
    // Gentle bus compression, then a limiter, so stacked effects and drums never clip.
    const limiter = new Tone.Limiter(-1).toDestination()
    const comp = new Tone.Compressor({ threshold: -12, ratio: 3, attack: 0.005, release: 0.2 }).connect(limiter)
    const widener = new Tone.StereoWidener(0.5).connect(comp)
    const reverb = new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: 0 }).connect(widener)
    const delay = new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.3, wet: 0, maxDelay: 4 }).connect(reverb)
    const keysVol = new Tone.Volume(0).connect(delay)
    const drumsVol = new Tone.Volume(0).connect(delay)
    // Tone's tremolo centres its gain on 0.5 whatever the depth; ×2 makes depth 0 exactly unity.
    const tremoloGain = new Tone.Gain(2)
    const tremolo = new Tone.Tremolo({ frequency: 4, depth: 0, spread: 180 }).connect(tremoloGain).start()
    const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0 })
    const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 })
    const eq = new Tone.EQ3(0, 0, 0)
    const filter = new Tone.Filter({ frequency: 20000, type: 'lowpass', rolloff: -12, Q: 0.7 })
    const drive = new Tone.Distortion({ distortion: 0.3, wet: 0 })
    // The stages are wired by rewire(): only effects that are turned up sit in the signal path.
    return { input: new Tone.Gain(), tremoloGain, drive, filter, eq, chorus, phaser, tremolo, keysVol, drumsVol, delay, reverb, widener }
  }

  /**
   * Effects at zero still cost CPU (the phaser alone re-tunes 20 filters every sample), which caused crackles.
   * Route the keys only through the stages that are on; reconnect when one is turned up or back to zero.
   */
  private rewire(e: Effective, later = false) {
    const c = this.chain!
    const stages: [boolean, Tone.ToneAudioNode, Tone.ToneAudioNode][] = [
      [e.drive > 0, c.drive, c.drive],
      [e.cutoff < 19999 || e.filterType !== 'lowpass', c.filter, c.filter],
      [e.eqLow !== 0 || e.eqMid !== 0 || e.eqHigh !== 0, c.eq, c.eq],
      [e.chorus > 0, c.chorus, c.chorus],
      [e.phaser > 0, c.phaser, c.phaser],
      [e.tremolo > 0, c.tremolo, c.tremoloGain],
    ]
    let key = stages.map((x) => +x[0]).join('')
    clearTimeout(this.rewireTimer)
    // Taking a stage out: keep it wired until apply()'s ramp has brought it to 0, so a preset switch doesn't click.
    if (!later && [...this.wired].some((b, i) => b === '1' && key[i] === '0')) {
      this.rewireTimer = window.setTimeout(() => this.rewire(this.applied as Effective, true), RAMP * 1000 + 30)
      key = [...key].map((b, i) => (b === '1' || this.wired[i] === '1' ? '1' : '0')).join('') // add new stages now, remove later
    }
    if (key === this.wired) return
    const chorusWas = this.wired[3] === '1'
    this.wired = key
    c.input.disconnect()
    for (const [, , out] of stages) out.disconnect()
    let prev: Tone.ToneAudioNode = c.input
    stages.forEach(([, inp, out], i) => { if (key[i] === '1') { prev.connect(inp); prev = out } })
    prev.connect(c.keysVol)
    // Its LFO only runs while wired (start/stop on change only: restarting a running source throws in Tone).
    if (key[3] === '1' && !chorusWas) c.chorus.start(); else if (key[3] !== '1' && chorusWas) c.chorus.stop()
  }

  /** Latest parameters per instrument (from the store); the one for the current instrument is applied. */
  setSounds(s: Partial<Record<InstrumentId, Params>>) { this.sounds = s; this.apply() }
  setTempo(bpm: number) { if (bpm !== this.bpm) { this.bpm = bpm; this.apply() } }

  /** Push the current sound into the graph, touching only values that changed, with short ramps. */
  private apply() {
    const c = this.chain
    if (!c) return
    const e = effective(this.sounds[this.inst] ?? defaults(this.inst), this.inst)
    this.rewire(e)
    const a = this.applied
    const ramp = (k: keyof Effective, p: { rampTo(v: number, t: number): unknown }, v = e[k] as number) => { if (a[k] !== e[k]) p.rampTo(v, RAMP) }
    ramp('cutoff', c.filter.frequency)
    ramp('resonance', c.filter.Q)
    if (a.filterType !== e.filterType) c.filter.type = e.filterType
    ramp('drive', c.drive.wet)
    ramp('eqLow', c.eq.low); ramp('eqMid', c.eq.mid); ramp('eqHigh', c.eq.high)
    ramp('chorus', c.chorus.wet)
    ramp('phaser', c.phaser.wet)
    ramp('tremolo', c.tremolo.depth, e.tremolo * 0.7)
    if (a.lfoRate !== e.lfoRate) { c.phaser.frequency.rampTo(e.lfoRate / 4, RAMP); c.tremolo.frequency.rampTo(e.lfoRate, RAMP) }
    ramp('keysVol', c.keysVol.volume); ramp('drumsVol', c.drumsVol.volume)
    if (a.delayBeats !== e.delayBeats || this.appliedBpm !== this.bpm) c.delay.delayTime.rampTo(Math.min(4, e.delayBeats * 60 / this.bpm), 0.05)
    this.appliedBpm = this.bpm
    ramp('delayFeedback', c.delay.feedback); ramp('delayMix', c.delay.wet)
    ramp('reverbMix', c.reverb.wet)
    ramp('width', c.widener.width)
    if (this.vibrato) ramp('vibratoRate', this.vibrato.frequency)
    // Tone.Reverb renders a new impulse on every decay/pre-delay change; wait until the knob rests.
    // The old impulse keeps playing until the new one is ready.
    if (Math.abs((a.reverbDecay ?? 0) - e.reverbDecay) > 0.02 || a.reverbPreDelay !== e.reverbPreDelay) {
      clearTimeout(this.reverbTimer)
      this.reverbTimer = window.setTimeout(() => { c.reverb.decay = e.reverbDecay; c.reverb.preDelay = e.reverbPreDelay }, 250)
    } else e.reverbDecay = a.reverbDecay ?? e.reverbDecay
    this.applied = e
    const v = this.voices.get(this.inst)
    if (v) this.applyVoice(this.inst, v)
    if (this.fallback) this.applyVoice('piano', this.fallback)
  }
  private appliedBpm = 0

  /** Envelope, glide and timbre live on the voices; PolySynth.set reaches every allocated voice. */
  private applyVoice(id: InstrumentId, v: Voice) {
    if (id !== this.inst) return
    const e = this.applied as Effective
    if (v instanceof Tone.Sampler) { v.attack = e.attack; v.release = e.release; return }
    const opts: Record<string, unknown> = id === 'piano' ? { envelope: { attack: e.attack, release: e.release } }
      : { envelope: { attack: e.attack, decay: e.decay, sustain: e.sustain, release: e.release } }
    if (id === 'epiano') opts.modulationIndex = e.modIndex
    if (id === 'strings') opts.harmonicity = e.harmonicity
    if (id === 'synth') { opts.portamento = e.glide; opts.oscillator = { spread: e.spread } }
    const key = JSON.stringify(opts)
    if (this.voiceKeys.get(v) === key) return
    this.voiceKeys.set(v, key)
    v.set(opts)
  }

  /** A small synthesized kit (no samples, works offline): Kick, Snare, Closed hat, Open hat, Clap, Low tom, High tom, Crash. */
  private makeKit() {
    // Drums skip the keys' filter/drive/modulation but share the delay and reverb (and their own volume).
    const bus = new Tone.Gain(0.8).connect(this.chain!.drumsVol)
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(bus)
    const snareBody = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -8 }).connect(bus)
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -10 }).connect(new Tone.Filter(1800, 'highpass').connect(bus))
    const hat = (decay: number) => new Tone.MetalSynth({ envelope: { attack: 0.001, decay, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -22 }).connect(bus)
    const closed = hat(0.05), open = hat(0.35), crash = hat(1.4)
    const clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.16, sustain: 0 }, volume: -8 }).connect(new Tone.Filter(1200, 'bandpass').connect(bus))
    const tom = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 0.35, sustain: 0 }, volume: -4 }).connect(bus)
    const tomHi = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 0.3, sustain: 0 }, volume: -4 }).connect(bus)
    return [
      (t: number, v: number) => kick.triggerAttackRelease('C1', 0.3, t, v),
      (t: number, v: number) => { snare.triggerAttackRelease(0.15, t, v); snareBody.triggerAttackRelease('G2', 0.1, t, v) },
      (t: number, v: number) => closed.triggerAttackRelease(300, 0.05, t, v),
      (t: number, v: number) => open.triggerAttackRelease(300, 0.3, t, v),
      (t: number, v: number) => clap.triggerAttackRelease(0.12, t, v),
      (t: number, v: number) => tom.triggerAttackRelease('G2', 0.3, t, v),
      (t: number, v: number) => tomHi.triggerAttackRelease('D3', 0.25, t, v),
      (t: number, v: number) => crash.triggerAttackRelease(300, 1.2, t, v * 0.8),
    ]
  }

  /** Play drum `k` (0–7). Each drum is monophonic, so start times must strictly increase. */
  drum(k: number, time = this.now(), vel = 100) {
    const hit = this.kit[k]
    if (!hit) return
    const t = Math.max(time, this.now(), (this.lastHit[k] ?? 0) + 0.01)
    this.lastHit[k] = t
    hit(t, this.gain(vel))
  }

  /** Pitch strip: −1..1 bends the synth sounds by up to ±2 semitones. The sampled piano doesn't bend, like a real one. */
  setBend(v: number) {
    this.bendCents = Math.round(v * 200)
    this.voices.forEach((voice) => { if (voice instanceof Tone.PolySynth) voice.set({ detune: this.bendCents }) })
  }
  /** Mod strip: 0..1 → vibrato depth on the synth sounds. */
  setMod(m: number) { if (this.vibrato) this.vibrato.depth.value = m * 0.3 }

  private makePiano(): Voice {
    const urls: Record<string, string> = {}
    for (let o = 1; o <= 7; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) urls[`${n.replace('s', '#')}${o}`] = `${n}${o}.mp3`
    urls.A0 = 'A0.mp3'
    urls.C8 = 'C8.mp3'
    return new Tone.Sampler({
      urls,
      baseUrl: `${import.meta.env.BASE_URL}samples/piano/`,
      release: 0.9,
      onload: () => { this.pianoLoaded = true },
      onerror: () => {
        // Missing samples: fall back to a light synth so the app still makes sound.
        this.pianoFailed = true
        const v = this.makeSynth('piano')
        this.voices.set('piano', v)
        this.applyVoice('piano', v)
      },
    }).connect(this.chain!.input)
  }

  private makeSynth(id: InstrumentId): Voice {
    const out = this.vibrato ?? Tone.getDestination()
    const v = id === 'epiano' ? new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3, modulationIndex: 6, envelope: { attack: 0.002, decay: 1.2, sustain: 0.25, release: 0.8 }, volume: -10 })
      : id === 'strings' ? new Tone.PolySynth(Tone.AMSynth, { envelope: { attack: 0.25, decay: 0.3, sustain: 0.8, release: 1.4 }, volume: -12 })
      // Three stacked saws; Timbre sets their detune spread.
      : id === 'synth' ? new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 20 }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 }, volume: -22 })
      // piano fallback
      : new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.003, decay: 1.4, sustain: 0.1, release: 0.6 }, volume: -8 })
    v.set({ detune: this.bendCents })
    v.maxPolyphony = 64 // default 32 drops notes under the pedal with long releases
    return v.connect(out)
  }

  private voice(id = this.inst): Voice | null {
    if (!this.started) return null
    let v = this.voices.get(id)
    if (!v) { v = this.makeSynth(id); this.voices.set(id, v); this.applyVoice(id, v) }
    // Sampler not loaded yet: use the fallback synth rather than dropping the note.
    if (v instanceof Tone.Sampler && !v.loaded) {
      if (!this.fallback) { this.fallback = this.makeSynth('piano'); this.applyVoice('piano', this.fallback) }
      return this.fallback
    }
    return v
  }

  /** Perceptual curve: MIDI velocity is roughly logarithmic in loudness. */
  private gain(vel: number) { return Math.pow(Math.max(1, vel) / 127, 1.6) * 0.95 + 0.05 }

  // ---- live playing ----
  noteOn(pitch: number, vel: number) {
    const v = this.voice(); if (!v) return
    // Re-striking a key that still rings on another voice (instrument changed meanwhile): end the old one.
    const old = this.liveVoice.get(pitch)
    if (old && old !== v) old.triggerRelease(toneName(pitch), Tone.immediate())
    this.liveVoice.set(pitch, v)
    this.down.add(pitch)
    this.sustained.delete(pitch)
    v.triggerAttack(toneName(pitch), Tone.immediate(), this.gain(vel))
  }
  noteOff(pitch: number) {
    this.down.delete(pitch)
    if (this.sustain) { this.sustained.add(pitch); return }
    this.release(pitch)
  }
  /** Release on the voice that started the note – the instrument may have changed, or the piano finished loading. */
  private release(pitch: number) {
    const v = this.liveVoice.get(pitch) ?? this.voice()
    this.liveVoice.delete(pitch)
    v?.triggerRelease(toneName(pitch), Tone.immediate())
  }
  setSustain(down: boolean) {
    this.sustain = down
    if (down) return
    for (const p of this.sustained) if (!this.down.has(p)) this.release(p)
    this.sustained.clear()
  }

  // ---- scheduled playback (auto-played notes, recordings) ----
  schedule(pitch: number, time: number, durSec: number, vel = 80, instrument?: InstrumentId) {
    this.voice(instrument ?? this.backing ?? undefined)?.triggerAttackRelease(toneName(pitch), Math.max(0.05, durSec), Math.max(time, this.now()), this.gain(vel))
  }
  private lastClick = 0
  metronome(time: number, accent: boolean) {
    // A monophonic synth needs strictly increasing start times.
    const t = Math.max(time, this.now(), this.lastClick + 0.005)
    this.lastClick = t
    this.click?.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, t, accent ? 1 : 0.6)
  }
  /** Silence everything (stop/seek). */
  panic() {
    this.voices.forEach((v) => v.releaseAll())
    this.fallback?.releaseAll()
    this.sustained.clear()
    this.down.clear()
    this.liveVoice.clear()
  }

  setVolume(v01: number) { Tone.getDestination().volume.value = v01 <= 0 ? -Infinity : 20 * Math.log10(v01) }
  /** Measured output latency in seconds when the browser reports it (Chrome does). */
  get outputLatency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) }
}

export const audio = new AudioEngine()
