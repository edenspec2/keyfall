// Kirtan accompaniment: a tanpura or shruti-box drone on Sa, and dholak/kartal rhythm loops (theka) on the kirtan kit.
import * as Tone from 'tone'
import { audio } from './audioEngine'

export type Drone = 'off' | 'tanpura' | 'shruti'
export type Rhythm = 'off' | 'kaharwa' | 'dadra'
export interface KirtanSettings { drone: Drone; sa: number; rhythm: Rhythm; level: number }

// Kirtan kit pads: 0 Ge, 1 Na, 2 Tin, 3 Ka, 4 Kartals, 5 Manjira, 6 Ghungroo, 7 Khol.
const GE = 0, NA = 1, TIN = 2, KA = 3, KARTAL = 4, MANJIRA = 5
/** One entry per matra (an eighth note at the app tempo): the strokes that sound together. */
export const RHYTHMS: Record<Exclude<Rhythm, 'off'>, { label: string; matras: number[][] }> = {
  // Dha Ge Na Ti | Na Ka Dhi Na – kartals on every other matra, manjira on sam (beat 1)
  kaharwa: { label: 'Kaharwa (8 beats)', matras: [[GE, NA, KARTAL, MANJIRA], [GE], [NA, KARTAL], [TIN], [NA, KARTAL], [KA], [GE, NA, KARTAL], [NA]] },
  // Dha Dhin Na | Dha Tin Na – the lilting 6-beat cycle
  dadra: { label: 'Dadra (6 beats)', matras: [[GE, NA, KARTAL, MANJIRA], [GE, TIN], [NA], [GE, NA, KARTAL], [TIN], [NA]] },
}
export const SA_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
/** Tanpura strings, plucked in order: Pa, Sa, Sa, then the low Sa (semitones from Sa). */
export const TANPURA = [-5, 0, 0, -12]

const LOOKAHEAD = 0.12 // s scheduled ahead on the audio clock
const TICK = 25 // ms between scheduler wake-ups
const TANPURA_GAP = 0.65 // s between plucks; the low Sa then rests for one more gap
const TANPURA_RING = 3.2 // s a released pluck keeps ringing before its nodes are freed
const SHRUTI_RELEASE = 1.4 // s for the reeds to fade before their nodes are freed

/** Synth nodes cost audio-thread time just by existing, so each drone is built only while it's selected. */
interface Parts { nodes: Tone.ToneAudioNode[] }
interface Tanpura extends Parts { plucks: Tone.PluckSynth[] }
interface Shruti extends Parts { synth: Tone.PolySynth; holding: number | null } // holding: the Sa it sounds
const free = (p: Parts, afterSec: number) => window.setTimeout(() => p.nodes.forEach((n) => n.dispose()), afterSec * 1000)

class Accompaniment {
  private s: KirtanSettings = { drone: 'off', sa: 0, rhythm: 'off', level: 0.7 }
  /** A lesson brings its own drums; the loop pauses while one is open (the drone stays). */
  lessonOpen = false
  private timer = 0
  private out: Tone.Gain | null = null
  private tanpura: Tanpura | null = null
  private shruti: Shruti | null = null
  private nextPluck = 0
  private pluckIdx = 0
  private nextMatra = 0
  private matra = 0

  configure(s: KirtanSettings) {
    const was = this.s
    this.s = s
    if (this.out) this.out.gain.rampTo(s.level, 0.1)
    if (s.rhythm !== was.rhythm) this.matra = 0
    // Switching a drone off (or to the other one) frees it once its sound has faded.
    if (s.drone !== 'tanpura' && this.tanpura) { free(this.tanpura, TANPURA_RING); this.tanpura = null }
    if (s.drone !== 'shruti' && this.shruti) { this.shruti.synth.releaseAll(); free(this.shruti, SHRUTI_RELEASE); this.shruti = null }
    const on = s.drone !== 'off' || s.rhythm !== 'off'
    if (on && !this.timer) this.timer = window.setInterval(() => this.tick(), TICK)
    if (!on && this.timer) { clearInterval(this.timer); this.timer = 0 }
  }

  /** The output gain is made on first use, once the audio engine (and its effects bus) exists. */
  private ready(): boolean {
    if (this.out) return true
    const bus = audio.accompanimentBus()
    if (!bus) return false
    this.out = new Tone.Gain(this.s.level).connect(bus)
    return true
  }

  /** Tanpura: long-ringing plucked strings, slightly darkened. */
  private makeTanpura(): Tanpura {
    const tone = new Tone.Filter(2600, 'lowpass').connect(this.out!)
    const plucks = TANPURA.map(() => new Tone.PluckSynth({ attackNoise: 1.5, dampening: 3200, resonance: 0.985, release: 3, volume: -10 }).connect(tone))
    return { plucks, nodes: [...plucks, tone] }
  }

  /** Shruti box: reeds held on Sa–Pa–Sa', breathing gently. */
  private makeShruti(): Shruti {
    const filter = new Tone.Filter(1100, 'lowpass').connect(this.out!)
    const breath = new Tone.Tremolo({ frequency: 0.3, depth: 0.25 }).connect(filter).start()
    const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 6 }, envelope: { attack: 0.8, decay: 0.2, sustain: 1, release: 1.2 }, volume: -10 }).connect(breath)
    return { synth, holding: null, nodes: [synth, breath, filter] }
  }

  private tick() {
    if (!audio.running || !this.ready()) return
    const now = audio.now(), until = now + LOOKAHEAD
    const sa = 48 + this.s.sa // Sa in the octave below middle C

    if (this.s.drone === 'shruti') {
      const sh = (this.shruti ??= this.makeShruti())
      if (sh.holding !== sa) { // first time, or Sa changed: hold the new Sa–Pa–Sa'
        sh.synth.releaseAll(now)
        sh.synth.triggerAttack([sa, sa + 7, sa + 12].map((p) => Tone.Frequency(p, 'midi').toFrequency()), now)
        sh.holding = sa
      }
    }
    if (this.s.drone === 'tanpura') {
      const { plucks } = (this.tanpura ??= this.makeTanpura())
      if (this.nextPluck < now - 0.05) this.nextPluck = now // after a pause or a stalled tab: start fresh, no burst
      while (this.nextPluck < until) {
        const i = this.pluckIdx % TANPURA.length
        plucks[i].triggerAttack(Tone.Frequency(sa + TANPURA[i], 'midi').toFrequency(), this.nextPluck)
        this.nextPluck += TANPURA_GAP * (i === TANPURA.length - 1 ? 2 : 1)
        this.pluckIdx++
      }
    }

    if (this.s.rhythm !== 'off' && !this.lessonOpen) {
      const { matras } = RHYTHMS[this.s.rhythm]
      const step = 30 / audio.bpm // a matra is an eighth note at the app tempo
      if (this.nextMatra < now - 0.05) this.nextMatra = now
      while (this.nextMatra < until) {
        const m = this.matra % matras.length
        for (const d of matras[m]) audio.drum(d, this.nextMatra, m === 0 ? 112 : 88, 'kirtan')
        this.nextMatra += step
        this.matra++
      }
    }
  }
}

export const kirtan = new Accompaniment()
