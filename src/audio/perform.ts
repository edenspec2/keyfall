// Free-play performance FX: arpeggiator and chord memory. They change only what sounds; the
// InputEvent stream (scorer, recorder) keeps the raw keys because live.ts calls this after midi.emit.
import { arpPattern, ARP_RATES, randomStep, transposeShape, type ArpSettings, type ChordSettings } from './arp'
import { audio } from './audioEngine'

const LOOKAHEAD = 0.1 // s of arp notes scheduled ahead on the audio clock
const TICK = 25 // ms between scheduler wake-ups (timer jitter is absorbed by the lookahead)

class Performer {
  arp: ArpSettings = { on: false, mode: 'up', rate: 1, octaves: 1, gate: 0.6, latch: false }
  chord: ChordSettings = { on: false, shape: [0, 4, 7] }
  private sounding = new Map<number, number>() // pitch → how many keys are holding it (chord memory overlaps)
  private routed = new Map<number, number[]>() // key → pitches it started directly
  private pool: number[] = [] // arp input, in the order the keys went down
  private keysDown = new Set<number>() // keys feeding the arp
  private direct = new Set<number>() // keys played straight through (FX off)
  private vel = 90
  private step = 0
  private prevRandom = -1
  private next = 0
  private timer = 0

  private get active() { return audio.performFx && (this.arp.on || this.chord.on) }

  configure(arp: ArpSettings, chord: ChordSettings) {
    const wasArp = this.arp.on
    this.arp = arp
    this.chord = chord
    if (wasArp && !arp.on) this.stopArp()
    // Latch released: keep arpeggiating only what is still held.
    else if (!arp.latch && this.pool.length) { this.pool = [...new Set([...this.keysDown].flatMap((k) => this.expand(k)))]; if (!this.pool.length) this.stopArp() }
  }
  private expand(key: number) { return this.chord.on ? transposeShape(this.chord.shape, key) : [key] }

  noteOn(key: number, vel: number) {
    if (!this.active) { this.direct.add(key); audio.noteOn(key, vel); return }
    const notes = this.expand(key)
    if (this.arp.on) {
      // Latch: the first key after letting go of everything starts a new pattern.
      if (this.arp.latch && this.keysDown.size === 0) this.pool = []
      this.keysDown.add(key)
      this.vel = vel
      for (const p of notes) if (!this.pool.includes(p)) this.pool.push(p)
      if (!this.timer) this.startArp()
      return
    }
    this.routed.set(key, notes)
    for (const p of notes) {
      const n = this.sounding.get(p) ?? 0
      this.sounding.set(p, n + 1)
      if (n === 0) audio.noteOn(p, vel)
    }
  }

  noteOff(key: number) {
    if (this.direct.delete(key)) { audio.noteOff(key); return }
    const arpKey = this.keysDown.delete(key)
    const notes = this.routed.get(key)
    if (notes) {
      this.routed.delete(key)
      for (const p of notes) {
        const n = (this.sounding.get(p) ?? 1) - 1
        if (n > 0) this.sounding.set(p, n)
        else { this.sounding.delete(p); audio.noteOff(p) }
      }
      return
    }
    if (arpKey && !this.arp.latch) {
      // Keep notes another held key still contributes (chord memory shapes can overlap).
      const drop = this.expand(key), still = new Set([...this.keysDown].flatMap((k) => this.expand(k)))
      this.pool = this.pool.filter((p) => !drop.includes(p) || still.has(p))
      if (!this.pool.length) this.stopArp()
    }
  }

  private startArp() {
    this.step = 0
    this.next = audio.now() // the first note sounds at once, like pressing a key
    this.tick()
    this.timer = window.setInterval(() => this.tick(), TICK)
  }
  private stopArp() {
    clearInterval(this.timer)
    this.timer = 0
    this.pool = []
  }

  private tick() {
    if (!audio.performFx || !this.arp.on || !this.pool.length) { this.stopArp(); return }
    const spb = 60 / audio.bpm, stepSec = (ARP_RATES[this.arp.rate]?.beats ?? 0.5) * spb
    const now = audio.now()
    if (this.next < now - 0.05) this.next = now // the tab was asleep: don't burst through missed steps
    const pattern = arpPattern(this.pool, this.arp.mode, this.arp.octaves)
    while (this.next < now + LOOKAHEAD) {
      const i = this.arp.mode === 'random' ? (this.prevRandom = randomStep(pattern.length, this.prevRandom)) : this.step % pattern.length
      audio.schedule(pattern[i], this.next, stepSec * Math.max(0.05, this.arp.gate), this.vel, audio.instrument)
      this.step++
      this.next += stepSec
    }
  }
}

export const perform = new Performer()
