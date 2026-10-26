import type { NoteEvent } from '../music/types'

export type Grade = 'perfect' | 'good' | 'early' | 'late' | 'missed' | 'hit' // 'hit' = untimed (Wait mode)

export const WINDOW_MS = { perfect: 80, good: 160, max: 300 }
const CHORD_EPS = 1 / 32 // beats: onsets this close form one chord

export interface ScoredNote extends NoteEvent {
  idx: number
  group: number
  grade?: Grade
  offsetMs?: number // + = late
  pressBeat?: number
  heldBeats?: number
  maxMs: number // matching window; shrinks when the same pitch repeats quickly so presses aren't stolen
}

export interface Group { start: number; notes: ScoredNote[]; pressed: Set<number>; done: boolean }

export interface WrongNote { played: number; expected: number | null; beat: number }

export interface Summary {
  expected: number
  hits: number
  perfect: number
  good: number
  early: number
  late: number
  missed: number
  extras: number
  octaveErrors: number
  releasedEarly: number
  accuracy: number // hits / expected
  timing: number | null // (perfect+good)/hits, null when untimed
  meanOffsetMs: number | null
  notes: ScoredNote[]
  wrong: WrongNote[]
}

export interface ScorerOptions {
  timed: boolean
  together?: boolean // Wait mode: a chord counts only when all its keys are down at the same moment
  windowScale?: number // >1 widens the timing windows (early lessons)
}

export interface PressResult { kind: 'hit' | 'extra'; grade?: Grade; note?: ScoredNote; groupDone?: boolean }

/**
 * Matches the user's key presses against expected notes.
 * timed = true  → Rhythm/Loop: nearest same-pitch note inside ±300 ms, graded by offset.
 * timed = false → Wait: notes are taken chord by chord; a chord is done when all its pitches were pressed.
 */
export class Scorer {
  notes: ScoredNote[]
  groups: Group[] = []
  wrong: WrongNote[] = []
  octaveErrors = 0
  current = 0 // Wait mode: index of the chord being waited for
  readonly timed: boolean
  readonly together: boolean
  readonly w: { perfect: number; good: number; max: number }
  private down = new Set<number>()

  constructor(notes: NoteEvent[], opts: ScorerOptions | boolean) {
    const o = typeof opts === 'boolean' ? { timed: opts } : opts
    this.timed = o.timed
    this.together = !!o.together
    const k = o.windowScale ?? 1
    this.w = { perfect: WINDOW_MS.perfect * k, good: WINDOW_MS.good * k, max: WINDOW_MS.max * k }
    // Unison duplicates (same pitch, same onset) are one key press on a keyboard: keep one.
    const unique = notes.filter((n, i) => notes.findIndex((m) => m.pitch === n.pitch && Math.abs(m.start - n.start) < CHORD_EPS) === i)
    this.notes = unique.sort((a, b) => a.start - b.start || a.pitch - b.pitch).map((n, idx) => ({ ...n, idx, group: 0, maxMs: this.w.max }))
    for (const n of this.notes) {
      const g = this.groups[this.groups.length - 1]
      if (g && n.start - g.start < CHORD_EPS) g.notes.push(n)
      else this.groups.push({ start: n.start, notes: [n], pressed: new Set(), done: false })
      n.group = this.groups.length - 1
    }
  }

  /** Window in ms for a note at the current tempo: at most half the gap to the neighbouring same-pitch note. */
  private windowMs(n: ScoredNote, spb: number) {
    let gap = Infinity
    for (const m of this.notes) if (m !== n && m.pitch === n.pitch) gap = Math.min(gap, Math.abs(m.start - n.start) * spb * 1000)
    return Math.min(this.w.max, gap / 2)
  }

  get finished() { return this.timed ? this.notes.every((n) => n.grade) : this.current >= this.groups.length }
  get currentGroup(): Group | undefined { return this.groups[this.current] }

  press(pitch: number, beat: number, secPerBeat: number): PressResult {
    return this.timed ? this.pressTimed(pitch, beat, secPerBeat) : this.pressWait(pitch, beat)
  }

  private pressWait(pitch: number, beat: number): PressResult {
    this.down.add(pitch)
    const g = this.currentGroup
    if (!g) return { kind: 'extra' }
    const note = g.notes.find((n) => n.pitch === pitch)
    if (!note) {
      this.recordWrong(pitch, beat, g.notes.filter((n) => !n.grade).map((n) => n.pitch))
      return { kind: 'extra' }
    }
    note.grade = 'hit'
    note.pressBeat = beat
    note.heldBeats = undefined
    g.pressed.add(pitch)
    const complete = g.notes.every((n) => n.grade) && (!this.together || g.notes.every((n) => this.down.has(n.pitch)))
    if (complete) { g.done = true; this.current++ }
    return { kind: 'hit', grade: 'hit', note, groupDone: g.done }
  }

  /** Wait mode with `together`: pitches of the current chord that still need to be (re)pressed. */
  pendingPitches(): number[] {
    const g = this.currentGroup
    if (!g) return []
    return g.notes.filter((n) => !n.grade || (this.together && !this.down.has(n.pitch))).map((n) => n.pitch)
  }

  /** Timed modes: would this press match a note? (Used to route presses across a loop boundary.) */
  canMatch(pitch: number, beat: number, spb: number) {
    return this.notes.some((n) => !n.grade && n.pitch === pitch && Math.abs((beat - n.start) * spb * 1000) <= this.windowMs(n, spb))
  }

  private pressTimed(pitch: number, beat: number, spb: number): PressResult {
    const msOff = (n: ScoredNote) => (beat - n.start) * spb * 1000
    let best: ScoredNote | undefined
    for (const n of this.notes) {
      if (n.grade || n.pitch !== pitch || Math.abs(msOff(n)) > this.windowMs(n, spb)) continue
      if (!best || Math.abs(msOff(n)) < Math.abs(msOff(best))) best = n
    }
    if (!best) {
      const near = this.notes.filter((n) => !n.grade && Math.abs(msOff(n)) <= this.w.max).map((n) => n.pitch)
      this.recordWrong(pitch, beat, near)
      return { kind: 'extra' }
    }
    const off = msOff(best)
    best.offsetMs = off
    best.pressBeat = beat
    best.grade = Math.abs(off) <= this.w.perfect ? 'perfect' : Math.abs(off) <= this.w.good ? 'good' : off < 0 ? 'early' : 'late'
    return { kind: 'hit', grade: best.grade, note: best }
  }

  private recordWrong(pitch: number, beat: number, candidates: number[]) {
    const expected = candidates.length ? candidates.reduce((a, b) => (Math.abs(b - pitch) < Math.abs(a - pitch) ? b : a)) : null
    if (expected !== null && Math.abs(expected - pitch) === 12) this.octaveErrors++
    this.wrong.push({ played: pitch, expected, beat })
  }

  release(pitch: number, beat: number) {
    this.down.delete(pitch)
    // The most recent pressed-but-not-released note of this pitch.
    const n = [...this.notes].reverse().find((x) => x.pitch === pitch && x.pressBeat !== undefined && x.heldBeats === undefined)
    if (n) n.heldBeats = beat - n.pressBeat!
  }

  /** Timed modes: mark notes whose window has passed as missed. Returns newly missed notes. */
  advance(beat: number, spb: number): ScoredNote[] {
    if (!this.timed) return []
    const out: ScoredNote[] = []
    for (const n of this.notes) {
      if (!n.grade && (beat - n.start) * spb * 1000 > this.windowMs(n, spb)) { n.grade = 'missed'; out.push(n) }
    }
    return out
  }

  summary(): Summary {
    const c = (g: Grade) => this.notes.filter((n) => n.grade === g).length
    const hitsArr = this.notes.filter((n) => n.grade && n.grade !== 'missed')
    const perfect = c('perfect'), good = c('good')
    const offs = hitsArr.map((n) => n.offsetMs).filter((x): x is number => x !== undefined)
    return {
      expected: this.notes.length,
      hits: hitsArr.length,
      perfect, good, early: c('early'), late: c('late'),
      missed: this.notes.length - hitsArr.length,
      extras: this.wrong.length,
      octaveErrors: this.octaveErrors,
      // Only notes of a beat or longer: on short notes an early release is inaudible.
      // Untimed (Wait mode) presses can come early, so held length means nothing there.
      releasedEarly: !this.timed ? 0 : this.notes.filter((n) => n.dur >= 1 && n.heldBeats !== undefined && n.heldBeats < n.dur * 0.5).length,
      accuracy: this.notes.length ? hitsArr.length / this.notes.length : 1,
      timing: this.timed && hitsArr.length ? (perfect + good) / hitsArr.length : null,
      meanOffsetMs: offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : null,
      notes: this.notes,
      wrong: this.wrong,
    }
  }
}
