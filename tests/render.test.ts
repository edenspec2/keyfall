import { describe, expect, it } from 'vitest'
import { lowerBound, visibleNotes } from '../src/render/pianoRenderer'
import { Scorer } from '../src/engine/scorer'
import type { NoteEvent } from '../src/music/types'

const n = (pitch: number, start: number, dur: number): NoteEvent => ({ pitch, start, dur, hand: 'R' })

describe('renderer note index', () => {
  it('lowerBound finds the first value ≥ v', () => {
    const a = Float64Array.from([0, 1, 1, 2, 5])
    expect([lowerBound(a, -1), lowerBound(a, 1), lowerBound(a, 1.5), lowerBound(a, 9)]).toEqual([0, 1, 3, 5])
  })
  it('visibleNotes returns exactly the notes overlapping the window, from unsorted input', () => {
    const notes = [n(60, 10, 1), n(62, 0, 8), n(64, 4, 0.5), n(65, 5.9, 0.2), n(67, 6, 1), n(69, 3, 0.9)]
    const got = visibleNotes(notes, 4, 6, []).map((i) => notes[i].pitch).sort()
    // The long note started at 0 still overlaps; the one ending at 3.9 and the ones starting at 6 or later do not.
    expect(got).toEqual([62, 64, 65])
  })
  it('matches a brute-force scan on a dense random piece', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const notes = Array.from({ length: 2000 }, () => n(48 + Math.floor(rnd() * 25), rnd() * 400, 0.1 + rnd() * 6))
    for (let k = 0; k < 50; k++) {
      const from = rnd() * 400, to = from + 1 + rnd() * 10
      const brute = notes.map((x, i) => (x.start < to && x.start + x.dur > from ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b)
      expect(visibleNotes(notes, from, to, []).sort((a, b) => a - b)).toEqual(brute)
    }
  })
})

describe('scorer bookkeeping', () => {
  it('logs every grade once, in order, and keeps the source note', () => {
    const notes = [n(60, 0, 1), n(62, 1, 1), n(64, 2, 1)]
    const s = new Scorer(notes, true)
    s.press(60, 0.02, 0.5)
    s.advance(10, 0.5) // the other two are missed
    expect(s.graded.map((x) => [x.pitch, x.grade])).toEqual([[60, 'perfect'], [62, 'missed'], [64, 'missed']])
    expect(s.graded[0].src).toBe(notes[0])
    s.advance(20, 0.5)
    expect(s.graded).toHaveLength(3)
  })
  it('advance stays fast on long pieces (no rescans of graded notes)', () => {
    const notes = Array.from({ length: 5000 }, (_, i) => n(60 + (i % 12), i * 0.25, 0.25))
    const s = new Scorer(notes, true)
    const t0 = performance.now()
    for (let f = 0; f < 5000; f++) s.advance(f * 0.25, 0.5)
    expect(performance.now() - t0).toBeLessThan(250)
    s.advance(Infinity, 0.5)
    expect(s.graded).toHaveLength(5000)
  })
})
