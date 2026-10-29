import * as Tone from 'tone'

// A light polyphonic synth built from the browser's own nodes. Each note makes a few oscillators and gains when it
// starts and drops them when it ends, so nothing runs between notes. Measured on the phone engine: a Tone.PolySynth
// (each voice a graph of dozens of Tone nodes) took a PC's audio thread to 99 % on a 6-note e-piano chord and still
// cost ~15 % ten seconds later. This one mirrors the Tone voices it replaces – Synth with a detuned "fat" stack,
// FMSynth and AMSynth – with the same levels and default modulation, so the instruments keep their sound.

export interface Patch {
  kind: 'osc' | 'fm' | 'am'
  type: OscillatorType | 'custom'
  partials?: number[] // for 'custom': harmonic amplitudes, fundamental first
  count: number // detuned copies stacked like Tone's fat oscillators (1 = a single oscillator)
  spread: number // cents across the stack
  harmonicity: number // fm/am: modulator frequency ÷ note frequency
  modulationIndex: number // fm depth
  envelope: { attack: number; decay: number; sustain: number; release: number }
  volume: number // dB
  portamento: number // s: glide from the previous note
}
type Settable = { envelope?: Partial<Patch['envelope']>; detune?: number; modulationIndex?: number; harmonicity?: number; portamento?: number; oscillator?: { spread?: number } }

interface Note { name: string; oscs: OscillatorNode[]; offsets: number[]; nodes: AudioNode[]; amp: GainNode; modEnv?: GainNode; released: boolean }

const db = (d: number) => 10 ** (d / 20)
const VOICE = db(-10) // Tone's FM/AM synths run carrier and modulator at -10 dB
const MOD_ENV = { attack: 0.5, release: 0.5 } // Tone's default modulation envelope (decay 0, sustain 1)

/** Note name ("C#4", "Bb3") or MIDI number to Hz. */
export function noteHz(note: string | number) {
  if (typeof note === 'number') return 440 * 2 ** ((note - 69) / 12)
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(note)
  if (!m) throw new Error(`not a note: ${note}`)
  const midi = 12 * (+m[3] + 1) + [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(m[1])] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  return 440 * 2 ** ((midi - 69) / 12)
}

export class NativeSynth {
  readonly output: GainNode
  maxPolyphony = 32
  private notes: Note[] = []
  private detune = 0
  private lastHz = 0
  private wave: PeriodicWave | null = null
  private ctx: BaseAudioContext
  private p: Patch

  constructor(ctx: BaseAudioContext, patch: Patch) {
    this.ctx = ctx
    const p = (this.p = { ...patch, envelope: { ...patch.envelope } })
    this.output = ctx.createGain()
    this.output.gain.value = db(p.volume)
    if (p.type === 'custom') this.wave = ctx.createPeriodicWave(new Float32Array(p.partials!.length + 1), Float32Array.from([0, ...p.partials!]))
    // Tone's fat oscillator starts copy i at i/count of a cycle (copy 0 is the plain wave). The copies partly cancel,
    // which shapes the sound (without it the stack measured 6.6 dB louder at the attack and far brighter).
    else for (let i = 1; i < p.count; i++) this.stack[i] = phasedWave(ctx, p.type, (2 * Math.PI * i) / p.count)
  }
  private stack: PeriodicWave[] = []

  connect(dest: Tone.InputNode) { Tone.connect(this.output, dest); return this }
  disconnect() { this.output.disconnect(); return this }

  /** The knobs (envelope, FM depth, AM harmonicity, glide, stack spread) apply from the next note; detune (pitch bend) at once. */
  set(o: Settable) {
    if (o.envelope) this.p.envelope = { ...this.p.envelope, ...o.envelope }
    if (o.modulationIndex !== undefined) this.p.modulationIndex = o.modulationIndex
    if (o.harmonicity !== undefined) this.p.harmonicity = o.harmonicity
    if (o.portamento !== undefined) this.p.portamento = o.portamento
    if (o.oscillator?.spread !== undefined) this.p.spread = o.oscillator.spread
    if (o.detune !== undefined) {
      this.detune = o.detune
      const t = this.ctx.currentTime
      for (const n of this.notes) n.oscs.forEach((osc, i) => osc.detune.setValueAtTime(this.detune + n.offsets[i], t))
    }
  }

  triggerAttack(note: string | number, time: number, velocity = 1) { this.attack(note, time, velocity) }
  triggerAttackRelease(note: string | number, duration: number, time: number, velocity = 1) { this.release(this.attack(note, time, velocity), time + duration) }
  /** Releases one sounding copy of that note (the oldest), like Tone's PolySynth. */
  triggerRelease(note: string | number, time: number) {
    const name = String(note)
    const n = this.notes.find((x) => x.name === name && !x.released)
    if (n) this.release(n, time)
  }
  releaseAll(time = this.ctx.currentTime) { for (const n of this.notes) if (!n.released) this.release(n, time) }

  private attack(note: string | number, time: number, velocity: number): Note {
    const live = this.notes.filter((x) => !x.released)
    if (live.length >= this.maxPolyphony) this.release(live[0], time) // steal the oldest
    const { ctx, p } = this
    const hz = noteHz(note)
    const osc = (type: OscillatorType | 'custom' | PeriodicWave, f: number) => {
      const o = ctx.createOscillator()
      if (typeof type !== 'string') o.setPeriodicWave(type)
      else if (type === 'custom') o.setPeriodicWave(this.wave!)
      else o.type = type as OscillatorType
      const glide = p.portamento > 0 && this.lastHz > 0
      o.frequency.setValueAtTime(glide ? f * (this.lastHz / hz) : f, time) // a modulator glides in proportion
      if (glide) o.frequency.exponentialRampToValueAtTime(f, time + p.portamento)
      return o
    }
    const amp = ctx.createGain()
    amp.gain.value = 0
    const n: Note = { name: String(note), oscs: [], offsets: [], nodes: [amp], amp, released: false }

    if (p.kind === 'osc') {
      // Tone's fat oscillator: copies evenly detuned across `spread`, each at -6 - 1.1·count dB.
      const c = Math.max(1, Math.round(p.count))
      for (let i = 0; i < c; i++) {
        const o = osc(this.stack[i] ?? p.type, hz)
        n.oscs.push(o); n.offsets.push(c > 1 ? -p.spread / 2 + (p.spread / (c - 1)) * i : 0)
        o.connect(amp)
      }
      this.envelope(amp.gain, time, velocity * (c > 1 ? db(-6 - c * 1.1) : 1))
      amp.connect(this.output)
    } else {
      const carrier = osc(p.type, hz), mod = osc('square', hz * p.harmonicity)
      const modEnv = ctx.createGain()
      modEnv.gain.value = 0
      n.oscs.push(carrier, mod); n.offsets.push(0, 0); n.nodes.push(modEnv); n.modEnv = modEnv
      mod.connect(modEnv)
      this.envelope(amp.gain, time, velocity * VOICE)
      if (p.kind === 'fm') {
        // Frequency modulation: the carrier's pitch moves by note Hz × index × the modulator's (enveloped) level.
        const depth = ctx.createGain()
        depth.gain.value = hz * p.modulationIndex
        n.nodes.push(depth)
        modEnv.connect(depth).connect(carrier.frequency)
        this.modEnvelope(modEnv.gain, time, velocity * VOICE)
        carrier.connect(amp).connect(this.output)
      } else {
        // Amplitude modulation: level = 0.5 + 0.5 × the modulator's (enveloped) signal, as Tone's AudioToGain.
        const am = ctx.createGain()
        am.gain.value = 0.5
        n.nodes.push(am)
        modEnv.connect(am.gain)
        this.modEnvelope(modEnv.gain, time, velocity * VOICE * 0.5)
        carrier.connect(amp).connect(am).connect(this.output)
      }
    }
    n.oscs.forEach((o, i) => { o.detune.setValueAtTime(this.detune + n.offsets[i], time); o.start(time) })
    n.oscs[0].onended = () => {
      for (const node of [...n.oscs, ...n.nodes]) node.disconnect()
      const i = this.notes.indexOf(n)
      if (i >= 0) this.notes.splice(i, 1)
    }
    this.lastHz = hz
    this.notes.push(n)
    return n
  }

  private release(n: Note, time: number) {
    n.released = true
    const r = Math.max(0.005, this.p.envelope.release)
    fade(n.amp.gain, time, r)
    if (n.modEnv) fade(n.modEnv.gain, time, MOD_ENV.release)
    const end = time + Math.max(r, n.modEnv ? MOD_ENV.release : 0) + 0.05
    for (const o of n.oscs) o.stop(end)
  }

  /** Linear attack to `peak`, then Tone's exponential decay to the sustain level. */
  private envelope(g: AudioParam, t: number, peak: number) {
    const { attack, decay, sustain } = this.p.envelope
    const a = Math.max(0.001, attack)
    g.setValueAtTime(0, t)
    g.linearRampToValueAtTime(peak, t + a)
    approach(g, peak * sustain, t + a, Math.max(0.001, decay))
  }
  private modEnvelope(g: AudioParam, t: number, peak: number) {
    g.setValueAtTime(0, t)
    g.linearRampToValueAtTime(peak, t + MOD_ENV.attack)
  }
}

/** From wherever the level is at `t`, Tone's exponential release, reaching silence exactly after `seconds`. */
function fade(g: AudioParam, t: number, seconds: number) {
  g.cancelAndHoldAtTime(t)
  approach(g, 0, t, seconds)
}

/** Tone's exponentialApproachValueAtTime: an exponential curve, finished with a straight line over its last 10 %. */
function approach(g: AudioParam, value: number, t: number, ramp: number) {
  g.setTargetAtTime(value, t, Math.log(ramp + 1) / Math.log(200))
  g.cancelAndHoldAtTime(t + ramp * 0.9)
  g.linearRampToValueAtTime(value, t + ramp)
}

/** Tone's phase-shifted basic wave (its Oscillator._getRealImaginary): 2047 harmonics, starting `phase` radians in. */
function phasedWave(ctx: BaseAudioContext, type: OscillatorType, phase: number) {
  const N = 2048, real = new Float32Array(N), imag = new Float32Array(N)
  for (let n = 1; n < N; n++) {
    const f = 2 / (n * Math.PI)
    const b = type === 'sine' ? (n === 1 ? 1 : 0) : type === 'square' ? (n & 1 ? 2 * f : 0)
      : type === 'sawtooth' ? f * (n & 1 ? 1 : -1) : n & 1 ? 2 * f * f * (((n - 1) >> 1) & 1 ? -1 : 1) : 0
    real[n] = -b * Math.sin(phase * n)
    imag[n] = b * Math.cos(phase * n)
  }
  return ctx.createPeriodicWave(real, imag)
}
