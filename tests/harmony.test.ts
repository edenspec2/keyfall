import { describe, expect, it } from 'vitest'
import { accompaniment, detectKey, suggestChords } from '../src/music/harmony'
import type { NoteEvent } from '../src/music/types'

const mel = (s: string): NoteEvent[] => s.split(' ').map((p, i) => ({ pitch: +p, start: i, dur: 1, hand: 'R' }))

describe('harmony suggestions', () => {
  // Ode to Joy, first phrase: E E F G | G F E D | C C D E | E D D -
  const ode = mel('64 64 65 67 67 65 64 62 60 60 62 64 64 62 62 62')
  it('detects C major', () => { expect(detectKey(ode)?.name).toBe('C major') })
  it('starts on I, ends the half-cadence phrase on V, and stays diatonic', () => {
    const names = suggestChords(ode, 0, 4).map((c) => c.name)
    expect(names[0]).toBe('C')
    expect(names[3]).toBe('G')
    expect(names.every((n) => ['C', 'Dm', 'F', 'G', 'Am'].includes(n))).toBe(true)
  })
  it('ends on I when the melody ends on the tonic', () => {
    const tune = mel('64 62 60 62 64 64 64 64 62 62 64 62 60 60 60 60') // Mary-like, ends on C
    expect(suggestChords(tune, 0, 4).at(-1)!.name).toBe('C')
  })
  it('accompaniment stays in the left-hand zone', () => {
    const acc = accompaniment(suggestChords(ode, 0, 4), 4)
    expect(acc.every((n) => n.pitch >= 48 && n.pitch <= 59)).toBe(true)
    expect(acc).toHaveLength(4 * 2 * 3)
  })
})
