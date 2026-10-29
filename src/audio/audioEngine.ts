import * as Tone from 'tone'
import { kit as drumKit, type Kit } from '../music/drums'
import { toneName } from '../music/theory'
import { defaults, effective, type Effective, type Params } from './sound'
import { track } from '../analytics'
import { NativeSynth, type Patch } from './nativeSynth'

export type InstrumentId = 'piano' | 'epiano' | 'strings' | 'synth' | 'harmonium' | 'bansuri'
export const INSTRUMENTS: { id: InstrumentId; label: string }[] = [
  { id: 'piano', label: 'Grand piano' },
  { id: 'epiano', label: 'Electric piano' },
  { id: 'strings', label: 'Soft strings' },
  { id: 'synth', label: 'Synth lead' },
  { id: 'harmonium', label: 'Harmonium' },
  { id: 'bansuri', label: 'Bansuri flute' },
]

type Voice = Tone.Sampler | NativeSynth
const RAMP = 0.04 // s: long enough to avoid zipper noise from 7-bit knob steps, short enough to feel direct
const XFADE = 0.03 // s: switching an effect in or out
const REVERB_XFADE = 0.15 // s: from the old reverb to a newly rendered one

/** A drum kit: what each pad plays, and every node it built (disposed together when the kit is dropped). */
interface DrumSet { hits: ((time: number, vel: number) => void)[]; nodes: Tone.ToneAudioNode[] }
/** Seconds without a drum hit before the kits are disposed. */
const KIT_IDLE = 30

interface MetalOpts { decay: number; release: number; harmonicity: number; modulationIndex: number; resonance: number; octaves: number; volume: number }
/**
 * A metallic hit (hats, crash, kartals, manjira) played as (frequency, duration, time, velocity). Phones get
 * high-passed noise instead of Tone's MetalSynth: its six FM oscillator pairs cost ~9 % of a PC's audio thread
 * from the moment it exists, filtered noise about 0.5 %.
 */
function metal(light: boolean, o: MetalOpts, bus: Tone.ToneAudioNode, nodes: Tone.ToneAudioNode[]) {
  if (!light) {
    const m = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: o.decay, release: o.release }, harmonicity: o.harmonicity, modulationIndex: o.modulationIndex, resonance: o.resonance, octaves: o.octaves, volume: o.volume }).connect(bus)
    nodes.push(m)
    return (freq: number, dur: number, t: number, v: number) => { m.triggerAttackRelease(freq, dur, t, v) }
  }
  const hp = new Tone.Filter(o.resonance, 'highpass').connect(bus)
  const n = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: o.decay, sustain: 0, release: o.release }, volume: o.volume + NOISE_TRIM }).connect(hp)
  nodes.push(hp, n)
  return (_freq: number, dur: number, t: number, v: number) => { n.triggerAttackRelease(dur, t, v) }
}
/** dB added to the noise stand-in to sound as loud as the MetalSynth it replaces (measured: hats 11–13 dB, bells 4–10). */
const NOISE_TRIM = 10

/** A stage that can be switched off to save CPU, without a click. */
interface Bypass { input: Tone.Gain; output: Tone.Gain; set(on: boolean): void }
/**
 * Switching by reconnecting the graph clicked: the path jumped in one step and a freshly connected filter starts
 * from silence. Here the stage crossfades with a dry path, and only stops processing once it has faded out.
 */
function bypass(node: Tone.ToneAudioNode): Bypass {
  const input = new Tone.Gain(), output = new Tone.Gain()
  const dry = new Tone.Gain(1).connect(output), wet = new Tone.Gain(0).connect(output)
  input.connect(dry)
  node.connect(wet)
  let on = false, timer = 0
  return {
    input, output,
    set(v) {
      if (v === on) return
      on = v
      clearTimeout(timer)
      if (v) input.connect(node)
      wet.gain.rampTo(v ? 1 : 0, XFADE)
      dry.gain.rampTo(v ? 0 : 1, XFADE)
      if (!v) timer = window.setTimeout(() => { if (!on) input.disconnect(node) }, XFADE * 1000 + 50)
    },
  }
}

/** The effects chain. Keys: input → drive → filter → EQ → chorus → phaser → tremolo → keys vol; drums join after it. */
interface Chain {
  input: Tone.Gain; filter: Tone.Filter; keysVol: Tone.Volume; drumsVol: Tone.Volume
  fx: Fx | null // null in the light engine: phones get no effects at all
}
interface Fx {
  tremoloGain: Tone.Gain
  drive: Tone.Distortion; eq: Tone.EQ3; chorus: Tone.Chorus; phaser: Tone.Phaser; tremolo: Tone.Tremolo
  bypass: { drive: Bypass; eq: Bypass; phaser: Bypass }
  delay: Tone.FeedbackDelay; widener: Tone.StereoWidener
  // Two fully-wet reverbs: a new length renders into the idle one, then the sound crossfades to it.
  reverbs: [Tone.Reverb, Tone.Reverb]; reverbGains: [Tone.Gain, Tone.Gain]; reverbDry: Tone.Gain
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
  private native = false
  /**
   * Light engine: notes go only through the filter, volume and limiter, and no effects are built. A Redmi's audio
   * thread could not keep up with the full chain: its sound check measured signal inside the graph but played static,
   * then silence. On by default on phones; 'full' or 'light' can be forced in Settings (read once, at start).
   */
  light = false
  private out: Tone.ToneAudioNode | null = null // end of the chain, tapped by the sound check

  /**
   * On-device sound check, for phones we can't watch: is the audio clock moving, and how loud is the signal from a
   * plain Tone synth sent straight to the speakers (what muted.io does) versus the app's own path (voice → effects →
   * limiter)? Each step plays a short tone; the peak level is measured inside the graph, so it shows where sound stops.
   */
  async selfTest(step: (label: string) => void) {
    await this.start()
    this.resume()
    const c = this.ctx
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const peakOf = async (node: Tone.ToneAudioNode, play: () => void) => {
      const m = new Tone.Meter({ normalRange: true, smoothing: 0 })
      node.connect(m)
      play()
      let peak = 0
      for (let i = 0; i < 12; i++) { await wait(50); const v = m.getValue(); peak = Math.max(peak, typeof v === 'number' ? v : Math.max(...v)) }
      node.disconnect(m); m.dispose()
      return Math.round(peak * 1000) / 1000
    }
    const t0 = c.currentTime
    await wait(300)
    const clock = c.currentTime > t0
    step('2 of 3: Tone.js straight to the speakers')
    const synth = new Tone.Synth({ volume: -8 }).toDestination()
    const direct = await peakOf(synth, () => synth.triggerAttackRelease('A5', 0.4))
    synth.dispose()
    step("3 of 3: the app's piano path")
    const chain = this.out ? await peakOf(this.out, () => this.schedule(72, this.now() + 0.02, 0.45, 110)) : -1
    return { state: c.state, clock, direct, chain, rate: c.sampleRate }
  }
  private inst: InstrumentId = 'piano'
  private voices = new Map<InstrumentId, Voice>()
  private sustained = new Set<number>() // released while the pedal was down
  private down = new Set<number>()
  private sustain = false
  private click: Tone.Synth | null = null
  private fallback: Voice | null = null
  private vibrato: Tone.Vibrato | null = null
  private kit: DrumSet | null = null
  private kirtanKit: DrumSet | null = null
  private kitTimer = 0
  private lastHit: number[] = []
  private mod = 0 // mod-strip position 0..1
  private bendCents = 0
  private chain: Chain | null = null
  private sounds: Partial<Record<InstrumentId, Params>> = {}
  private applied: Partial<Effective> = {}
  private voiceKeys = new WeakMap<Voice, string>()
  private reverbTimer = 0
  private starting: Promise<void> | null = null
  private reverbOn = 0 // which of the two reverbs is playing
  private reverbJob = 0 // newest length request; older renders that finish late are dropped
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
    return (this.starting = this.boot().catch((err) => { this.starting = null; this.lastError = String(err); track('sound-failed', 'start', true); throw err })) // a failed start can be retried
  }
  /**
   * Ask the browser to run the audio clock. Called from every gesture until it runs: on phones a touch only counts
   * as a gesture when the finger lifts, and a phone can suspend audio again (screen lock, a call).
   */
  resume() {
    const c = this.ctx
    // NotAllowed only means "not a gesture yet" (a finger landing); the lift that follows starts the sound.
    if (c.state !== 'running') void c.resume().catch((err) => { if (err?.name !== 'NotAllowedError') this.lastError = `resume: ${err}` })
  }
  /** One line for the status readout: is the clock running, at what rate and latency, and is the piano in. */
  status() {
    if (!this.started) return 'Not started – tap the screen once'
    const c = this.ctx
    const piano = this.pianoFailed ? 'piano samples failed (synth piano)' : this.pianoLoaded ? 'piano loaded' : 'piano loading (synth meanwhile)'
    return `${c.state} · ${Math.round(c.sampleRate / 100) / 10} kHz · ${Math.round(this.outputLatency * 1000)} ms · ${piano} · ${this.native ? 'stable-buffer' : 'single'} context · ${this.light ? 'light' : 'full'} engine`
  }
  /** True once sound can actually be heard. */
  get running() { return this.started && this.ctx.state === 'running' }
  private async boot() {
    this.light = lightEngine()
    const prev = Tone.getContext()
    // One audio context for the whole session, like every web piano that works on phones: swapping in a new context
    // on the first tap and closing Tone's default one left a Redmi silent, while the same phone played muted.io (one
    // default context, resumed on tap) and a plain test beep. Only the "Stable" buffer setting needs its own context,
    // because a latency hint can only be chosen when a context is created. lookAhead 0: we schedule with explicit times.
    if (this.latencyHint === 'interactive' || prev.rawContext.state === 'closed') {
      prev.lookAhead = 0
      this.native = false
    } else {
      Tone.setContext(new Tone.Context({ latencyHint: this.latencyHint, lookAhead: 0 }))
      this.native = true
      void (prev as Tone.Context).close().catch(() => {}) // two live contexts would compete for the device
    }
    // Build everything before asking to resume, and don't wait for it: if this event was not a gesture the browser
    // accepts (a touch's press-down), resuming waits for the next one, and the instruments must already exist then.
    // Waiting here used to leave the app silent for good on phones.
    // The click and the drum kits are built on first use: a Tone object costs audio-thread time from the moment it
    // exists, connected or not (the kit's three hats alone ~27 % of a PC's audio thread with nothing playing).
    this.started = true
    this.chain = this.makeChain()
    // Synth sounds go through a vibrato the mod strip controls (depth 0 = no effect). It costs ~1.3 % of a PC's audio
    // thread from the moment it exists, so phones build it only when the bansuri or the mod strip first needs it.
    this.vibrato = this.light ? null : this.makeVibrato()
    this.voices.set('piano', this.makePiano())
    this.apply()
    this.resume()
  }

  private makeChain(): Chain {
    // Gentle bus compression, then a limiter, so stacked effects and drums never clip.
    // Not Tone.Limiter: it keeps the browser's 30 dB soft knee, so a signal 12 dB over came out only 1.5 dB lower.
    // Even hard-kneed, the browser's compressor lets fast peaks through (a loud chord reached 1.03-1.29, clipping
    // harshly), so a soft clipper ends the chain: straight up to 0.8, then rounded off below 1.0.
    const clip = new Tone.WaveShaper((x) => Math.sign(x) * (Math.abs(x) <= 0.8 ? Math.abs(x) : 0.8 + 0.2 * Math.tanh((Math.abs(x) - 0.8) / 0.2)), 2049).toDestination()
    const limiter = new Tone.Compressor({ threshold: -1, ratio: 20, knee: 0, attack: 0.003, release: 0.1 }).connect(clip)
    this.out = clip
    const input = new Tone.Gain()
    const filter = new Tone.Filter({ frequency: 20000, type: 'lowpass', rolloff: -12, Q: 0.7 })
    if (this.light) {
      // No effects on phones, not even idle ones: a Tone object costs audio-thread time just by existing, connected
      // or not (measured with nothing playing, % of a PC's audio thread: phaser 3.7, widener 3.3, chorus and
      // tremolo 1.9 each), and a budget phone is several times slower.
      // A piano note peaks near -15 dB and its ring falls to -40 dB within a second, which a phone speaker drops:
      // squeeze the range gently (the browser's compressor adds make-up gain itself) and add 8 dB, so held notes stay
      // audible. Measured offline against the earlier 3:1, 5 ms / 0.3 s setting: ringing notes duck 3.7 dB instead
      // of 9 when a new note hits (no pumping), and the 30 ms attack keeps the hammer's strike (+9.4 dB vs +6.6).
      const phone = new Tone.Compressor({ threshold: -24, ratio: 2, knee: 12, attack: 0.03, release: 1 }).connect(new Tone.Gain(2.5).connect(limiter)) // release: 1 s is the maximum
      const keysVol = new Tone.Volume(0).connect(phone), drumsVol = new Tone.Volume(0).connect(phone)
      input.connect(filter); filter.connect(keysVol)
      return { input, filter, keysVol, drumsVol, fx: null }
    }
    const comp = new Tone.Compressor({ threshold: -12, ratio: 3, attack: 0.005, release: 0.2 }).connect(limiter)
    const widener = new Tone.StereoWidener(0.5).connect(comp)
    const reverbDry = new Tone.Gain(1).connect(widener)
    const reverbGains: [Tone.Gain, Tone.Gain] = [new Tone.Gain(0).connect(widener), new Tone.Gain(0).connect(widener)]
    const reverbs: [Tone.Reverb, Tone.Reverb] = [
      new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: 1 }).connect(reverbGains[0]),
      new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: 1 }).connect(reverbGains[1]),
    ]
    const delay = new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.3, wet: 0, maxDelay: 4 })
    delay.connect(reverbDry)
    delay.connect(reverbs[0]) // only the playing reverb is fed: an idle convolver would cost CPU for nothing
    const keysVol = new Tone.Volume(0).connect(delay)
    const drumsVol = new Tone.Volume(0).connect(delay)
    // Tone's tremolo centres its gain on 0.5 whatever the depth; ×2 makes depth 0 exactly unity.
    const tremoloGain = new Tone.Gain(2).connect(keysVol)
    const tremolo = new Tone.Tremolo({ frequency: 4, depth: 0, spread: 180 }).connect(tremoloGain).start()
    const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0 })
    const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start()
    const eq = new Tone.EQ3(0, 0, 0)
    const drive = new Tone.Distortion({ distortion: 0.3, wet: 0 })
    // Measured CPU: filter, chorus and tremolo are nearly free, so they stay in the path for good;
    // drive, EQ and phaser cost 8–21 % each and switch in and out with a crossfade.
    const b = { drive: bypass(drive), eq: bypass(eq), phaser: bypass(phaser) }
    input.connect(b.drive.input); b.drive.output.connect(filter); filter.connect(b.eq.input); b.eq.output.connect(chorus)
    chorus.connect(b.phaser.input); b.phaser.output.connect(tremolo)
    return { input, filter, keysVol, drumsVol, fx: { tremoloGain, drive, eq, chorus, phaser, tremolo, bypass: b, delay, widener, reverbs, reverbGains, reverbDry } }
  }

  /** Effects at zero still cost CPU: drive, EQ and phaser leave the path (with a crossfade) while they're at zero. */
  private rewire(e: Effective) {
    const b = this.chain!.fx?.bypass
    if (!b) return
    b.drive.set(e.drive > 0)
    b.eq.set(e.eqLow !== 0 || e.eqMid !== 0 || e.eqHigh !== 0)
    b.phaser.set(e.phaser > 0)
  }

  /** Reverb mix as an equal-power crossfade, like Tone's own wet/dry. */
  private reverbMix(mix: number) {
    const c = this.chain!.fx
    if (!c) return
    c.reverbDry.gain.rampTo(Math.cos(mix * Math.PI / 2), RAMP)
    c.reverbGains[this.reverbOn].gain.rampTo(Math.sin(mix * Math.PI / 2), RAMP)
  }

  /** New reverb length: render it into the idle reverb, then crossfade, so the playing tail is never cut off. */
  private async reverbLength(decay: number, preDelay: number) {
    const c = this.chain!.fx, job = ++this.reverbJob
    if (!c) return
    const from = this.reverbOn, to = 1 - from, next = c.reverbs[to]
    if (next.decay !== decay) next.decay = decay
    if (next.preDelay !== preDelay) next.preDelay = preDelay
    await next.ready
    if (job !== this.reverbJob) return // the knob moved on; a newer render will take over
    c.delay.connect(next)
    const mix = (this.applied as Effective).reverbMix ?? 0
    c.reverbGains[to].gain.rampTo(Math.sin(mix * Math.PI / 2), REVERB_XFADE)
    c.reverbGains[from].gain.rampTo(0, REVERB_XFADE)
    this.reverbOn = to
    window.setTimeout(() => { if (this.reverbOn === to) c.delay.disconnect(c.reverbs[from]) }, REVERB_XFADE * 1000 + 50)
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
    ramp('keysVol', c.keysVol.volume); ramp('drumsVol', c.drumsVol.volume)
    const f = c.fx
    if (f) {
      ramp('drive', f.drive.wet)
      ramp('eqLow', f.eq.low); ramp('eqMid', f.eq.mid); ramp('eqHigh', f.eq.high)
      ramp('chorus', f.chorus.wet)
      ramp('phaser', f.phaser.wet)
      ramp('tremolo', f.tremolo.depth, e.tremolo * 0.7)
      if (a.lfoRate !== e.lfoRate) { f.phaser.frequency.rampTo(e.lfoRate / 4, RAMP); f.tremolo.frequency.rampTo(e.lfoRate, RAMP) }
      if (a.delayBeats !== e.delayBeats || this.appliedBpm !== this.bpm) f.delay.delayTime.rampTo(Math.min(4, e.delayBeats * 60 / this.bpm), 0.05)
      ramp('delayFeedback', f.delay.feedback); ramp('delayMix', f.delay.wet)
      ramp('width', f.widener.width)
    }
    this.appliedBpm = this.bpm
    if (a.reverbMix !== e.reverbMix) this.reverbMix(e.reverbMix)
    if (this.vibrato) ramp('vibratoRate', this.vibrato.frequency)
    // A new reverb length is a full impulse render; wait until the knob rests, then crossfade to it.
    if (Math.abs((a.reverbDecay ?? 0) - e.reverbDecay) > 0.02 || a.reverbPreDelay !== e.reverbPreDelay) {
      clearTimeout(this.reverbTimer)
      // The very first apply happens at start, when both reverbs already hold this length.
      if (a.reverbDecay !== undefined) this.reverbTimer = window.setTimeout(() => void this.reverbLength(e.reverbDecay, e.reverbPreDelay), 250)
    } else e.reverbDecay = a.reverbDecay ?? e.reverbDecay
    this.applied = e
    this.applyVibrato()
    const v = this.voices.get(this.inst)
    if (v) this.applyVoice(this.inst, v)
    for (const l of this.pianoLayers) this.applyVoice('piano', l.s) // every touch layer gets the attack/release knobs
    if (this.fallback) this.applyVoice('piano', this.fallback)
  }
  private appliedBpm = 0

  /** Envelope, glide and timbre live on the voices; set() applies them from the next note. */
  private applyVoice(id: InstrumentId, v: Voice) {
    if (id !== this.inst) return
    const e = this.applied as Effective
    if (v instanceof Tone.Sampler) { v.attack = e.attack; v.release = e.release; return }
    const opts: Record<string, unknown> = id === 'piano' ? { envelope: { attack: e.attack, release: e.release } }
      : { envelope: { attack: e.attack, decay: e.decay, sustain: e.sustain, release: e.release } }
    if (id === 'epiano') opts.modulationIndex = e.modIndex
    if (id === 'strings') opts.harmonicity = e.harmonicity
    if (id === 'synth') { opts.portamento = e.glide; opts.oscillator = { spread: e.spread } }
    if (id === 'harmonium') opts.oscillator = { spread: e.spread }
    const key = JSON.stringify(opts)
    if (this.voiceKeys.get(v) === key) return
    this.voiceKeys.set(v, key)
    v.set(opts)
  }

  /** A small synthesized kit (no samples, works offline): Kick, Snare, Closed hat, Open hat, Clap, Low tom, High tom, Crash. */
  private makeKit(): DrumSet {
    // Drums skip the keys' filter/drive/modulation but share the delay and reverb (and their own volume).
    const nodes: Tone.ToneAudioNode[] = [], k = <T extends Tone.ToneAudioNode>(n: T) => (nodes.push(n), n)
    const bus = k(new Tone.Gain(0.8)).connect(this.chain!.drumsVol)
    const kick = k(new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } })).connect(bus)
    const snareBody = k(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -8 })).connect(bus)
    const snare = k(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -10 })).connect(k(new Tone.Filter(1800, 'highpass')).connect(bus))
    const hat = (decay: number) => metal(this.light, { decay, release: 0.01, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -22 }, bus, nodes)
    const closed = hat(0.05), open = hat(0.35), crash = hat(1.4)
    const clap = k(new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.16, sustain: 0 }, volume: -8 })).connect(k(new Tone.Filter(1200, 'bandpass')).connect(bus))
    const tom = k(new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 0.35, sustain: 0 }, volume: -4 })).connect(bus)
    const tomHi = k(new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 0.3, sustain: 0 }, volume: -4 })).connect(bus)
    return { nodes, hits: [
      (t: number, v: number) => kick.triggerAttackRelease('C1', 0.3, t, v),
      (t: number, v: number) => { snare.triggerAttackRelease(0.15, t, v); snareBody.triggerAttackRelease('G2', 0.1, t, v) },
      (t: number, v: number) => closed(300, 0.05, t, v),
      (t: number, v: number) => open(300, 0.3, t, v),
      (t: number, v: number) => clap.triggerAttackRelease(0.12, t, v),
      (t: number, v: number) => tom.triggerAttackRelease('G2', 0.3, t, v),
      (t: number, v: number) => tomHi.triggerAttackRelease('D3', 0.25, t, v),
      (t: number, v: number) => crash(300, 1.2, t, v * 0.8),
    ] }
  }

  /** Kirtan kit: dholak strokes (Ge, Na, Tin, Ka), kartals, manjira, ghungroo and a deep khol – all synthesized. */
  private makeKirtanKit(): DrumSet {
    const nodes: Tone.ToneAudioNode[] = [], k = <T extends Tone.ToneAudioNode>(n: T) => (nodes.push(n), n)
    const bus = k(new Tone.Gain(0.8)).connect(this.chain!.drumsVol)
    const skin = (pitchDecay: number, octaves: number, decay: number, volume = 0) =>
      k(new Tone.MembraneSynth({ pitchDecay, octaves, envelope: { attack: 0.001, decay, sustain: 0, release: 0.05 }, volume })).connect(bus)
    const ge = skin(0.12, 2.5, 0.55), khol = skin(0.25, 3, 0.8, -5)
    const na = skin(0.008, 1.2, 0.28, -6), tin = skin(0.006, 1, 0.07, -8)
    const ka = k(new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0 }, volume: 10 })).connect(k(new Tone.Filter(1100, 'bandpass')).connect(bus))
    const bell = (decay: number, harmonicity: number, resonance: number, volume: number) =>
      metal(this.light, { decay, release: 0.05, harmonicity, modulationIndex: 20, resonance, octaves: 1, volume }, bus, nodes)
    const kartal = bell(0.12, 7.3, 6500, -11), manjira = bell(1.1, 12.1, 5200, -14)
    const ghungroo = k(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0 }, volume: -8 })).connect(k(new Tone.Filter(6500, 'highpass')).connect(bus))
    return { nodes, hits: [
      (t: number, v: number) => ge.triggerAttackRelease('A1', 0.4, t, v), // Ge: low dholak, pitch glides down
      (t: number, v: number) => na.triggerAttackRelease('D4', 0.2, t, v), // Na: open treble ring
      (t: number, v: number) => tin.triggerAttackRelease('F4', 0.06, t, v), // Tin: closed treble
      (t: number, v: number) => ka.triggerAttackRelease(0.05, t, v), // Ka: flat-hand slap
      (t: number, v: number) => kartal(900, 0.1, t, v), // Kartals: bright jingle
      (t: number, v: number) => manjira(1200, 1, t, v * 0.8), // Manjira: small cymbals that ring
      (t: number, v: number) => ghungroo.triggerAttackRelease(0.1, t, v), // Ghungroo: ankle bells / shaker
      (t: number, v: number) => khol.triggerAttackRelease('E1', 0.6, t, v), // Khol: deep mridanga bass
    ] }
  }

  /** Play drum `k` (0–7) of the current kit (or `kitId`). Each drum is monophonic, so start times must strictly increase. */
  drum(k: number, time = this.now(), vel = 100, kitId: Kit = drumKit.id) {
    if (!this.started) return
    const hit = (kitId === 'kirtan' ? (this.kirtanKit ??= this.makeKirtanKit()) : (this.kit ??= this.makeKit())).hits[k]
    if (!hit) return
    // A built kit costs audio time even when silent (~6 % of a PC's audio thread): after a quiet spell, drop both
    // kits; the next hit rebuilds one.
    clearTimeout(this.kitTimer)
    this.kitTimer = window.setTimeout(() => {
      for (const set of [this.kit, this.kirtanKit]) set?.nodes.forEach((n) => n.dispose())
      this.kit = this.kirtanKit = null
    }, KIT_IDLE * 1000)
    const slot = kitId === 'kirtan' ? k + 8 : k
    const t = Math.max(time, this.now(), (this.lastHit[slot] ?? 0) + 0.01)
    this.lastHit[slot] = t
    hit(t, this.gain(vel))
  }

  /** Where background parts (drone, rhythm loops) join: the drums' volume, then the shared delay and reverb. */
  accompanimentBus(): Tone.ToneAudioNode | null { return this.chain?.drumsVol ?? null }

  /** Pitch strip: −1..1 bends the synth sounds by up to ±2 semitones. The sampled piano doesn't bend, like a real one. */
  setBend(v: number) {
    this.bendCents = Math.round(v * 200)
    this.voices.forEach((voice) => { if (voice instanceof NativeSynth) voice.set({ detune: this.bendCents }) })
  }
  /** Mod strip: 0..1 → vibrato depth on the synth sounds. */
  setMod(m: number) { this.mod = m; this.applyVibrato() }
  /** The bansuri has a gentle vibrato of its own, like a breath; the mod strip adds to it. */
  private applyVibrato() {
    const depth = (this.inst === 'bansuri' ? 0.05 : 0) + this.mod * 0.3
    if (!this.vibrato && depth > 0 && this.chain) this.vibrato = this.makeVibrato() // phones: first use
    if (this.vibrato) this.vibrato.depth.value = depth
  }
  /** Synth voices made before it existed (on phones it is built on first use) are moved onto it. */
  private makeVibrato() {
    const v = new Tone.Vibrato((this.applied as Effective).vibratoRate ?? 5.5, 0).connect(this.chain!.input)
    for (const s of [...this.voices.values(), this.fallback]) if (s && !(s instanceof Tone.Sampler)) { s.disconnect(); s.connect(v) }
    return v
  }

  /**
   * Phones: fetch and decode the piano as soon as the page opens (decoding needs no tap; only playing does), so the
   * first notes are the piano, not the stand-in synth. Middle C outwards, one decode at a time (each full recording
   * is ~5 MB decoded), in an offline context that no later context swap can close.
   */
  preloadPiano() {
    if (this.pianoJobs || !lightEngine()) return
    try {
      const decoder = new OfflineAudioContext(2, 1, Tone.getContext().sampleRate)
      const order = [...PIANO_SAMPLES].sort((a, b) => Math.abs(a.midi - 60) - Math.abs(b.midi - 60))
      let prev: Promise<unknown> = Promise.resolve()
      // The medium layer first (it makes every note playable), then the hard one.
      this.pianoJobs = PIANO_LAYERS.filter((l) => l.phone).flatMap(({ dir, phoneSec }) => order.map(({ note, file }) => {
        const data = fetch(PIANO_URL + dir + file).then((r) => r.arrayBuffer())
        const job = Promise.all([data, prev]).then(([d]) => decoder.decodeAudioData(d)).then((b) => [dir, note, trimTail(decoder, b, -45, phoneSec)] as const)
        prev = job.catch(() => {})
        return job
      }))
      for (const j of this.pianoJobs) j.catch(() => {}) // reported once the engine waits on them, not as unhandled
    } catch { /* no offline decoding here: makePiano falls back to the synth piano */ }
  }
  private pianoJobs: Promise<readonly [string, string, AudioBuffer]>[] | null = null
  /** The piano's touch layers in velocity order; voice() plays the highest loaded one the velocity reaches. */
  private pianoLayers: Layer[] = []

  private makePiano(): Voice {
    const failed = () => {
      // Missing samples: fall back to a light synth so the app still makes sound.
      this.pianoFailed = true
      track('sound-failed', 'piano', true)
      const v = this.makeSynth('piano')
      this.voices.set('piano', v)
      this.applyVoice('piano', v)
    }
    const input = this.chain!.input
    if (!this.light) {
      const urls = Object.fromEntries(PIANO_SAMPLES.map((p) => [p.note, p.file]))
      this.pianoLayers = PIANO_LAYERS.map(({ dir, from }) => {
        const l: Layer = { from, ready: false, s: null as unknown as Tone.Sampler }
        // A soft or hard layer that fails to load is simply never used: the medium one plays every velocity.
        l.s = new Tone.Sampler({ urls, baseUrl: PIANO_URL + dir, release: 0.9, onload: () => { l.ready = true; if (!dir) this.pianoLoaded = true }, onerror: dir ? () => {} : failed }).connect(input)
        return l
      })
      return this.pianoLayers.find((l) => l.from === MEDIUM)!.s
    }
    this.pianoLayers = PIANO_LAYERS.filter((l) => l.phone).map(({ from }) => ({ from, ready: false, s: new Tone.Sampler({ release: 0.9 }).connect(input) }))
    const medium = this.pianoLayers.find((l) => l.from === MEDIUM)!
    this.preloadPiano()
    void (async () => {
      if (!this.pianoJobs) return failed()
      const added = new Map<string, number>()
      for (const job of this.pianoJobs) {
        let dir: string, note: string, b: AudioBuffer
        try { [dir, note, b] = await job } catch { if (!this.pianoLoaded) return failed(); continue } // a hard note missing: medium plays it
        const layer = this.pianoLayers[PIANO_LAYERS.filter((l) => l.phone).findIndex((l) => l.dir === dir)]
        layer.s.add(note as Tone.Unit.Note, b)
        const n = (added.get(dir) ?? 0) + 1
        added.set(dir, n)
        if (layer === medium && n === 12) this.pianoLoaded = true // 12 recordings from middle C out cover the MiniLab's range
        if (n === PIANO_SAMPLES.length) layer.ready = true // a layer plays only once complete: a gap would mean a far-pitched note
      }
      this.pianoLoaded = true
    })()
    return medium.s
  }

  private makeSynth(id: InstrumentId): Voice {
    const out = this.vibrato ?? this.chain!.input
    const base = { kind: 'osc', count: 1, spread: 0, harmonicity: 3, modulationIndex: 0, portamento: 0 } as const
    const patch: Patch = id === 'epiano' ? { ...base, kind: 'fm', type: 'sine', modulationIndex: 6, envelope: { attack: 0.002, decay: 1.2, sustain: 0.25, release: 0.8 }, volume: -10 }
      : id === 'strings' ? { ...base, kind: 'am', type: 'sine', envelope: { attack: 0.25, decay: 0.3, sustain: 0.8, release: 1.4 }, volume: -12 }
      // Three stacked saws; Timbre sets their detune spread.
      : id === 'synth' ? { ...base, type: 'sawtooth', count: 3, spread: 20, envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 }, volume: -22 }
      // Harmonium: three slightly detuned reeds (the beating of the reed banks; Timbre sets it), a bellows swell,
      // and full sustain while the key is held. The nasal reed colour comes from its default filter and EQ.
      : id === 'harmonium' ? { ...base, type: 'sawtooth', count: 3, spread: 12, envelope: { attack: 0.05, decay: 0.2, sustain: 0.9, release: 0.15 }, volume: -20 }
      // Bansuri: a nearly pure, soft tone (fundamental + a few weak overtones) with a breathy swell; its natural
      // vibrato comes from applyVibrato(), its airiness from the default chorus and reverb.
      : id === 'bansuri' ? { ...base, type: 'custom', partials: [1, 0.32, 0.12, 0.05, 0.02], envelope: { attack: 0.08, decay: 0.15, sustain: 0.85, release: 0.3 }, volume: -20 }
      // piano fallback
      : { ...base, type: 'triangle', envelope: { attack: 0.003, decay: 1.4, sustain: 0.1, release: 0.6 }, volume: -8 }
    const v = new NativeSynth(this.ctx, patch)
    v.set({ detune: this.bendCents })
    v.maxPolyphony = 64 // under the pedal with long releases
    return v.connect(out)
  }

  private voice(id = this.inst, vel = 64): Voice | null {
    if (!this.started) return null
    let v = this.voices.get(id)
    if (!v) { v = this.makeSynth(id); this.voices.set(id, v); this.applyVoice(id, v) }
    // Sampler not loaded yet: use the fallback synth rather than dropping the note.
    if (v instanceof Tone.Sampler && !this.pianoLoaded) {
      if (!this.fallback) { this.fallback = this.makeSynth('piano'); this.applyVoice('piano', this.fallback) }
      return this.fallback
    }
    return v instanceof Tone.Sampler ? pickLayer(this.pianoLayers, vel, v) : v
  }

  /** Perceptual curve: MIDI velocity is roughly logarithmic in loudness. */
  private gain(vel: number) { return Math.pow(Math.max(1, vel) / 127, 1.6) * 0.95 + 0.05 }

  // ---- live playing ----
  noteOn(pitch: number, vel: number) {
    const v = this.voice(this.inst, vel); if (!v) return
    // Re-striking a key that still rings (under the pedal, or on another instrument): end the old note first.
    // A synth releases only one sounding copy per pitch, so a second attack on top would ring forever after pedal-up.
    const old = this.liveVoice.get(pitch)
    if (old) old.triggerRelease(toneName(pitch), Tone.immediate())
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
    this.voice(instrument ?? this.backing ?? this.inst, vel)?.triggerAttackRelease(toneName(pitch), Math.max(0.05, durSec), Math.max(time, this.now()), this.gain(vel))
  }
  private lastClick = 0
  metronome(time: number, accent: boolean) {
    if (!this.started) return
    this.click ??= new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 }, volume: -14 }).toDestination()
    // A monophonic synth needs strictly increasing start times.
    const t = Math.max(time, this.now(), this.lastClick + 0.005)
    this.lastClick = t
    this.click.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, t, accent ? 1 : 0.6)
  }
  /** Silence everything (stop/seek). */
  panic() {
    this.voices.forEach((v) => v.releaseAll())
    for (const l of this.pianoLayers) l.s.releaseAll()
    this.fallback?.releaseAll()
    this.sustained.clear()
    this.down.clear()
    this.liveVoice.clear()
  }

  // Ramped: fader 4 drives this, and a hard step on every MIDI message zippers. -80 dB is silent enough for "0".
  setVolume(v01: number) { Tone.getDestination().volume.rampTo(v01 <= 0 ? -80 : Math.max(-80, 20 * Math.log10(v01)), RAMP) }
  /** Measured output latency in seconds when the browser reports it (Chrome does). */
  get outputLatency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) }
}

/** Salamander grand piano (CC-BY 3.0): every minor third from A0 to C8; the sampler pitches the notes between. */
// From this module, not the page: the built module sits in assets/, so this works from any page (the app, welcome/).
const PIANO_URL = new URL(import.meta.env.DEV ? '/samples/piano/' : '../samples/piano/', import.meta.url).href
const PIANO_SAMPLES = [
  { note: 'A0', file: 'A0.mp3', midi: 21 },
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((o) => (['C', 'Ds', 'Fs', 'A'] as const).map((n, i) => ({ note: `${n.replace('s', '#')}${o}`, file: `${n}${o}.mp3`, midi: 12 * (o + 1) + [0, 3, 6, 9][i] }))),
  { note: 'C8', file: 'C8.mp3', midi: 108 },
]

/**
 * Touch layers: Salamander v4, v8 and v14, each note leveled to its v8 recording, so loudness still follows the app's
 * velocity curve and only the tone brightens with a harder touch. A layer plays from MIDI velocity `from` up. Phones
 * skip the soft layer and keep the hard one to 6 s: each layer is ~100 MB once decoded.
 */
const MEDIUM = 49
const PIANO_LAYERS = [
  { dir: 'soft/', from: 1, phone: false, phoneSec: 10 },
  { dir: '', from: MEDIUM, phone: true, phoneSec: 10 },
  { dir: 'hard/', from: 97, phone: true, phoneSec: 6 },
]
interface Layer { from: number; ready: boolean; s: Tone.Sampler }
/** The highest ready layer the velocity reaches; below every ready layer, `fallback` (the medium recordings). */
export function pickLayer<T>(layers: { from: number; ready: boolean; s: T }[], vel: number, fallback: T) {
  let best = fallback
  for (const l of layers) if (l.ready && vel >= l.from) best = l.s
  return best
}

/**
 * A recording kept until it has faded `floorDb` below its strike (at least 2.5 s, at most `maxSec`), with a one-second
 * fade where it is cut, in stereo as recorded. Measured: notes take 8-20 s to fade 45 dB, and the phone's old fixed
 * 4 s cut was audible on held notes; summing the channels to mono cancelled 1.4-4 dB (the two mics are far apart).
 */
export function trimTail(ctx: BaseAudioContext, b: AudioBuffer, floorDb = -45, maxSec = 10) {
  const sr = b.sampleRate, chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c))
  let peak = 0 // a piano's loudest moment is its strike, in the first second
  for (const x of chs) for (let i = 0, m = Math.min(x.length, sr); i < m; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a }
  const floor = peak * 10 ** (floorDb / 20)
  let last = 0
  for (const x of chs) for (let i = x.length - 1; i > last; i--) if (Math.abs(x[i]) > floor) { last = i; break }
  const n = Math.min(b.length, Math.max(Math.round(2.5 * sr), last + 1), Math.round(maxSec * sr))
  if (n === b.length) return b
  const out = ctx.createBuffer(chs.length, n, sr), fade = Math.min(n, sr)
  chs.forEach((x, c) => { const d = out.getChannelData(c); d.set(x.subarray(0, n)); for (let i = n - fade; i < n; i++) d[i] *= (n - i) / fade })
  return out
}

/** 'auto' (light on phones and tablets), 'full' or 'light'; kept in its own key so the choice survives a reload. */
export const ENGINE_KEY = 'pianoapp.v1.engine'
export function lightEngine() {
  let pick = 'auto'
  try { pick = localStorage.getItem(ENGINE_KEY) ?? 'auto' } catch { /* storage blocked: auto */ }
  if (pick !== 'auto') return pick === 'light'
  if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return true
  // A touch screen counts too: in Chrome's "Desktop site" mode a phone reports a PC user agent.
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

export const audio = new AudioEngine()
