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
  gap: number // beats to the nearest same-pitch note; the window shrinks to half of it so presses aren't stolen
  src: NoteEvent // the lesson note this was copied from (lets the renderer colour it without lookups)
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
  /** Every note in the order it was graded, so a frame loop can pick up new results without rescanning. */
  graded: ScoredNote[] = []
  private cursor = 0 // timed: notes before this index are all graded
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
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    const unique = sorted.filter((n, i) => !sorted.slice(Math.max(0, i - 16), i).some((m) => m.pitch === n.pitch && n.start - m.start < CHORD_EPS))
    this.notes = unique.map((n, idx) => ({ ...n, idx, group: 0, gap: Infinity, src: n }))
    // Gap to the neighbouring same-pitch note, computed once (it used to be rescanned on every press and frame).
    const lastOf = new Map<number, ScoredNote>()
    for (const n of this.notes) {
      const prev = lastOf.get(n.pitch)
      if (prev) { const g = n.start - prev.start; prev.gap = Math.min(prev.gap, g); n.gap = g }
      lastOf.set(n.pitch, n)
    }
    for (const n of this.notes) {
      const g = this.groups[this.groups.length - 1]
      if (g && n.start - g.start < CHORD_EPS) g.notes.push(n)
      else this.groups.push({ start: n.start, notes: [n], pressed: new Set(), done: false })
      n.group = this.groups.length - 1
    }
  }

  /** Window in ms for a note at the current tempo: at most half the gap to the neighbouring same-pitch note. */
  private windowMs(n: ScoredNote, spb: number) { return Math.min(this.w.max, n.gap * spb * 500) }

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
    if (!note.grade) this.graded.push(note)
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
    this.graded.push(best)
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
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i]
      if (n.pitch === pitch && n.pressBeat !== undefined && n.heldBeats === undefined) { n.heldBeats = beat - n.pressBeat; return }
    }
  }

  /** Timed modes: mark notes whose window has passed as missed. Returns newly missed notes. */
  advance(beat: number, spb: number): ScoredNote[] {
    if (!this.timed) return []
    const out: ScoredNote[] = []
    // Only notes that have started can be missed; everything before the cursor is already graded.
    for (let i = this.cursor; i < this.notes.length && this.notes[i].start < beat; i++) {
      const n = this.notes[i]
      if (!n.grade && (beat - n.start) * spb * 1000 > this.windowMs(n, spb)) { n.grade = 'missed'; out.push(n); this.graded.push(n) }
    }
    while (this.cursor < this.notes.length && this.notes[this.cursor].grade) this.cursor++
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
