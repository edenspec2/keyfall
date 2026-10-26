import { describe, expect, it } from 'vitest'
import { handPosition } from '../src/music/fingering'
import type { NoteEvent } from '../src/music/types'
import { CURRICULUM } from '../src/lessons/curriculum'

const seq = (hand: 'R' | 'L', pf: [number, number][]): NoteEvent[] => pf.map(([pitch, finger], i) => ({ pitch, finger, start: i, dur: 1, hand }))
const asMap = (s: ReturnType<typeof handPosition>) => Object.fromEntries(s.map((x) => [x.finger, x.pitch]))

describe('handPosition', () => {
  it('fills the whole five-finger shape from a three-note tune', () => {
    // Hot Cross Buns: E3 D2 C1 → thumb on C, then D E F G for fingers 2–5
    expect(asMap(handPosition(seq('R', [[64, 3], [62, 2], [60, 1]]), 'R', 0, 4))).toEqual({ 1: 60, 2: 62, 3: 64, 4: 65, 5: 67 })
  })
  it('stops at a thumb-under shift and shows the next position once the hand has moved', () => {
    const scale = seq('R', [[60, 1], [62, 2], [64, 3], [65, 1], [67, 2], [69, 3], [71, 4], [72, 5]])
    expect(asMap(handPosition(scale, 'R', 0, 8))).toMatchObject({ 1: 60, 2: 62, 3: 64 })
    expect(asMap(handPosition(scale, 'R', 3, 8))).toEqual({ 1: 65, 2: 67, 3: 69, 4: 71, 5: 72 })
  })
  it('mirrors the left hand: finger 5 is the lowest key', () => {
    expect(asMap(handPosition(seq('L', [[48, 5], [55, 1]]), 'L', 0, 4))).toEqual({ 5: 48, 4: 50, 3: 52, 2: 53, 1: 55 })
  })
  it('places fingers only on keys inside every lesson and never two fingers on one key', () => {
    for (const l of CURRICULUM) for (const hand of ['R', 'L'] as const) {
      const spots = handPosition(l.notes, hand, 0, l.timeSig[0])
      expect(new Set(spots.map((s) => s.pitch)).size).toBe(spots.length)
      expect(spots.every((s) => s.pitch >= 40 && s.pitch <= 80)).toBe(true)
    }
  })
})
