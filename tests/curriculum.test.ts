import { describe, expect, it } from 'vitest'
import { CURRICULUM, STAGES } from '../src/lessons/curriculum'
import { Session } from '../src/engine/session'

describe('curriculum', () => {
  it('has unique ids and covers all six stages', () => {
    expect(new Set(CURRICULUM.map((l) => l.id)).size).toBe(CURRICULUM.length)
    expect(new Set(CURRICULUM.map((l) => l.stage)).size).toBe(7)
    expect(STAGES).toHaveLength(7)
  })
  it.each(CURRICULUM.map((l) => [l.id, l] as const))('%s fits a 25-key MiniLab (C3–C5) or says which octave button to press', (_, l) => {
    const ps = [...l.notes.filter((n) => n.drum === undefined).map((n) => n.pitch), ...(l.phrases?.flat() ?? [])]
    const inRange = ps.every((p) => p >= 48 && p <= 72)
    expect(inRange || !!l.octaveHint).toBe(true)
    expect(l.notes.every((n) => n.dur > 0 && n.start >= 0)).toBe(true)
  })
  it.each(CURRICULUM.filter((l) => l.kind === 'play').map((l) => [l.id, l] as const))('%s gives the player notes to play', (_, l) => {
    const s = new Session(l, { mode: 'wait', hands: l.hands, bpm: l.bpm, metronome: false, loop: null, calibration: 0 }, { now: () => 0, heard: () => 0, schedule() {}, metronome() {}, panic() {} })
    expect(s.userNotes.length).toBeGreaterThan(0)
  })
  it('echo lessons have phrases and improvise lessons have a scale and backing', () => {
    for (const l of CURRICULUM) {
      if (l.kind === 'echo') expect(l.phrases?.length).toBeGreaterThan(0)
      if (l.kind === 'improvise') { expect(l.scale?.length).toBeGreaterThan(0); expect(l.notes.length).toBeGreaterThan(0) }
    }
  })
  it('pad lessons only use the 8 drums and unlock from an existing lesson', () => {
    const ids = new Set(CURRICULUM.map((l) => l.id))
    for (const l of CURRICULUM) {
      for (const n of l.notes) if (n.drum !== undefined) { expect(n.drum).toBeGreaterThanOrEqual(0); expect(n.drum).toBeLessThan(8); expect(n.pitch).toBe(200 + n.drum) }
      if (l.unlockAfter) expect(ids.has(l.unlockAfter)).toBe(true)
    }
    expect(CURRICULUM.filter((l) => l.notes.some((n) => n.drum !== undefined)).length).toBeGreaterThanOrEqual(3)
  })
})
