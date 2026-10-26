import { describe, expect, it } from 'vitest'
import { Scorer } from '../src/engine/scorer'
import type { NoteEvent } from '../src/music/types'

const n = (pitch: number, start: number, dur = 1): NoteEvent => ({ pitch, start, dur, hand: 'R' })
const SPB = 0.5 // 120 bpm: 1 beat = 500 ms

describe('Scorer – timed (Rhythm/Loop)', () => {
  it('grades by millisecond offset with tolerant windows', () => {
    const s = new Scorer([n(60, 0), n(62, 1), n(64, 2), n(65, 3)], true)
    expect(s.press(60, 0.1, SPB).grade).toBe('perfect') // +50 ms
    expect(s.press(62, 1.25, SPB).grade).toBe('good') // +125 ms
    expect(s.press(64, 1.6, SPB).grade).toBe('early') // −200 ms
    expect(s.press(65, 3.7, SPB).kind).toBe('extra') // +350 ms: outside the window
    s.advance(10, SPB)
    const sum = s.summary()
    expect(sum.hits).toBe(3)
    expect(sum.missed).toBe(1)
    expect(sum.extras).toBe(1)
    expect(sum.timing).toBeCloseTo(2 / 3)
  })

  it('scales windows with tempo so slow pieces are not harsher', () => {
    const slow = new Scorer([n(60, 0)], true)
    expect(slow.press(60, 0.1, 1.0).grade).toBe('good') // 60 bpm: 0.1 beat = 100 ms
  })

  it('evaluates chords as groups of notes in any order', () => {
    const s = new Scorer([n(60, 0), n(64, 0), n(67, 0)], true)
    expect(s.groups).toHaveLength(1)
    s.press(67, 0.02, SPB); s.press(60, 0.04, SPB); s.press(64, -0.03, SPB)
    expect(s.summary().accuracy).toBe(1)
  })

  it('detects octave mistakes', () => {
    const s = new Scorer([n(60, 0)], true)
    s.press(72, 0, SPB)
    expect(s.octaveErrors).toBe(1)
  })

  it('matches repeated pitches to the nearest note', () => {
    const s = new Scorer([n(60, 0), n(60, 0.5)], true)
    s.press(60, 0.45, SPB)
    expect(s.notes[1].grade).toBe('perfect')
    expect(s.notes[0].grade).toBeUndefined()
  })

  it('flags notes released well before their written length', () => {
    const s = new Scorer([n(60, 0, 2)], true)
    s.press(60, 0, SPB); s.release(60, 0.5)
    expect(s.summary().releasedEarly).toBe(1)
  })
})

describe('Scorer – Wait mode', () => {
  it('advances only when every pitch of the chord was pressed', () => {
    const s = new Scorer([n(48, 0), n(64, 0), n(67, 1)], false)
    expect(s.current).toBe(0)
    expect(s.press(64, 0, SPB).groupDone).toBe(false)
    expect(s.press(66, 0, SPB).kind).toBe('extra') // wrong key does not advance
    expect(s.current).toBe(0)
    expect(s.press(48, 0, SPB).groupDone).toBe(true)
    expect(s.current).toBe(1)
    s.press(67, 1, SPB)
    expect(s.finished).toBe(true)
    expect(s.summary().accuracy).toBe(1)
    expect(s.summary().timing).toBeNull() // not timed
  })

  it('does not accept the next chord early', () => {
    const s = new Scorer([n(60, 0), n(62, 1)], false)
    expect(s.press(62, 0, SPB).kind).toBe('extra')
  })
})

describe('Scorer – reviewer fixes', () => {
  it('does not let a fast repeated note steal its neighbour', () => {
    // Two C's 0.25 beat apart at 120 bpm = 125 ms: windows shrink to 62 ms each.
    const s = new Scorer([n(60, 0), n(60, 0.25)], true)
    s.press(60, 0.2, SPB) // 25 ms before the second C
    expect(s.notes[1].grade).toBe('perfect')
    s.advance(0.2, SPB)
    expect(s.notes[0].grade).toBe('missed')
  })
  it('Wait mode "together" needs every chord key down at once', () => {
    const s = new Scorer([n(60, 0), n(64, 0), n(67, 0)], { timed: false, together: true })
    s.press(60, 0, SPB); s.release(60, 0)
    s.press(64, 0, SPB); s.press(67, 0, SPB)
    expect(s.current).toBe(0)
    expect(s.pendingPitches()).toEqual([60])
    expect(s.press(60, 0, SPB).groupDone).toBe(true)
  })
  it('windowScale widens the windows for early lessons', () => {
    const s = new Scorer([n(60, 0)], { timed: true, windowScale: 1.5 })
    expect(s.press(60, 0.7, SPB).grade).toBe('late') // 350 ms: a miss at 1x, late inside 450 ms
  })
})
