import { describe, expect, it } from 'vitest'
import { makeFeedback, starsFor } from '../src/engine/feedback'
import { Scorer } from '../src/engine/scorer'
import type { Lesson, NoteEvent } from '../src/music/types'

const notes: NoteEvent[] = Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + (i % 3) * 2, start: i, dur: 1, hand: 'R' }))
const lesson: Lesson = { id: 'f', stage: 3, kind: 'play', title: 'F', goal: '', intro: [], bpm: 80, timeSig: [4, 4], notes, hands: 'R', pass: { minAccuracy: 0.85, minTiming: 0.7 } }

describe('feedback', () => {
  it('names late notes, the bar and a slower tempo', () => {
    const s = new Scorer(notes, true), spb = 60 / 80
    notes.forEach((n, i) => s.press(n.pitch, n.start + (i >= 5 ? 0.25 : 0), spb)) // last 3 notes ~190 ms late
    s.advance(99, spb)
    const fb = makeFeedback(lesson, 'rhythm', s.summary(), 80, [])
    expect(fb.good[0]).toContain('Every note was correct')
    expect(fb.improve[0]).toMatch(/3 notes came slightly after the beat \(about 188 ms\), mostly in bars? 2/)
    expect(fb.improve[0]).toContain('65 BPM')
  })
  it('does not complain about note length in Wait mode', () => {
    const s = new Scorer(notes, false)
    notes.forEach((n) => { s.press(n.pitch, 0, 1); s.release(n.pitch, 0.01) })
    expect(s.summary().releasedEarly).toBe(0)
    expect(starsFor(lesson, 'wait', s.summary(), 80)).toBe(1)
  })
  it('stars need measured timing at tempo, not time spent', () => {
    const s = new Scorer(notes, true)
    notes.forEach((n) => s.press(n.pitch, n.start, 0.75))
    expect(starsFor(lesson, 'rhythm', s.summary(), 50)).toBe(1) // too slow for 2 stars
    expect(starsFor(lesson, 'rhythm', s.summary(), 80)).toBe(3)
  })
  it('Loop mode never awards stars; one hand of a two-hand piece earns at most one', () => {
    const s = new Scorer(notes, true)
    notes.forEach((n) => s.press(n.pitch, n.start, 0.75))
    expect(starsFor(lesson, 'loop', s.summary(), 80)).toBe(0)
    expect(starsFor({ ...lesson, hands: 'both' }, 'rhythm', s.summary(), 80, true)).toBe(1)
    expect(makeFeedback(lesson, 'loop', s.summary(), 80, []).headline).toBe('Clean pass!')
  })
})
