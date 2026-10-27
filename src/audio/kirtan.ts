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

class Accompaniment {
  private s: KirtanSettings = { drone: 'off', sa: 0, rhythm: 'off', level: 0.7 }
  /** A lesson brings its own drums; the loop pauses while one is open (the drone stays). */
  lessonOpen = false
  private timer = 0
  private out: Tone.Gain | null = null
  private plucks: Tone.PluckSynth[] = []
  private shruti: Tone.PolySynth | null = null
  private shrutiOn: number | null = null // Sa the shruti box is holding
  private nextPluck = 0
  private pluckIdx = 0
  private nextMatra = 0
  private matra = 0

  configure(s: KirtanSettings) {
    const was = this.s
    this.s = s
    if (this.out) this.out.gain.rampTo(s.level, 0.1)
    if (s.rhythm !== was.rhythm) this.matra = 0
    if (s.drone !== 'shruti' || s.sa !== was.sa) this.stopShruti()
    const on = s.drone !== 'off' || s.rhythm !== 'off'
    if (on && !this.timer) this.timer = window.setInterval(() => this.tick(), TICK)
    if (!on && this.timer) { clearInterval(this.timer); this.timer = 0 }
  }

  /** Nodes are made on first use, once the audio engine (and its effects bus) exists. */
  private ready(): boolean {
    if (this.out) return true
    const bus = audio.accompanimentBus()
    if (!bus) return false
    this.out = new Tone.Gain(this.s.level).connect(bus)
    // Tanpura: long-ringing plucked strings, slightly darkened.
    const tone = new Tone.Filter(2600, 'lowpass').connect(this.out)
    this.plucks = TANPURA.map(() => new Tone.PluckSynth({ attackNoise: 1.5, dampening: 3200, resonance: 0.985, release: 3, volume: -10 }).connect(tone))
    // Shruti box: reeds held on Sa–Pa–Sa', breathing gently.
    const breath = new Tone.Tremolo({ frequency: 0.3, depth: 0.25 }).connect(new Tone.Filter(1100, 'lowpass').connect(this.out)).start()
    this.shruti = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 6 }, envelope: { attack: 0.8, decay: 0.2, sustain: 1, release: 1.2 }, volume: -10 }).connect(breath)
    return true
  }

  private stopShruti() {
    if (this.shrutiOn !== null) this.shruti?.releaseAll()
    this.shrutiOn = null
  }

  private tick() {
    if (!audio.running || !this.ready()) return
    const now = audio.now(), until = now + LOOKAHEAD
    const sa = 48 + this.s.sa // Sa in the octave below middle C

    if (this.s.drone === 'shruti' && this.shrutiOn !== sa) {
      this.stopShruti()
      this.shruti!.triggerAttack([sa, sa + 7, sa + 12].map((p) => Tone.Frequency(p, 'midi').toFrequency()), now)
      this.shrutiOn = sa
    }
    if (this.s.drone === 'tanpura') {
      if (this.nextPluck < now - 0.05) this.nextPluck = now // after a pause or a stalled tab: start fresh, no burst
      while (this.nextPluck < until) {
        const i = this.pluckIdx % TANPURA.length
        this.plucks[i].triggerAttack(Tone.Frequency(sa + TANPURA[i], 'midi').toFrequency(), this.nextPluck)
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
