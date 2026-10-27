import { describe, expect, it } from 'vitest'
import { RHYTHMS, TANPURA } from '../src/audio/kirtan'
import { currentDrums, KIRTAN_DRUMS, kit } from '../src/music/drums'
import { noteName } from '../src/music/theory'

describe('kirtan accompaniment', () => {
  it('thekas have the right number of matras and start on a full Dha with kartals', () => {
    expect(RHYTHMS.kaharwa.matras).toHaveLength(8)
    expect(RHYTHMS.dadra.matras).toHaveLength(6)
    for (const r of Object.values(RHYTHMS)) {
      expect(r.matras[0]).toEqual(expect.arrayContaining([0, 1, 4])) // Ge + Na (= Dha) + kartals on sam
      expect(r.matras.flat().every((d) => d >= 0 && d < 8)).toBe(true)
    }
  })
  it('the tanpura plucks Pa, Sa, Sa and the low Sa', () => {
    expect(TANPURA).toEqual([-5, 0, 0, -12])
  })
  it('switching the kit renames the pads (and drum notes) everywhere', () => {
    expect(noteName(200)).toBe('Kick')
    kit.id = 'kirtan'
    expect(currentDrums()).toBe(KIRTAN_DRUMS)
    expect(noteName(200)).toBe('Ge (dholak bass)')
    kit.id = 'standard'
  })
})
