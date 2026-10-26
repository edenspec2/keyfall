import { describe, expect, it } from 'vitest'
import { identifyChord, intervalName, noteNameOct, romanNumeral, parseKey } from '../src/music/theory'
import { voicing } from '../src/ui/Explore'

describe('theory', () => {
  it('names notes with octaves (60 = C4)', () => {
    expect(noteNameOct(60)).toBe('C4')
    expect(noteNameOct(48)).toBe('C3')
    expect(noteNameOct(61)).toBe('C♯4')
  })
  it('identifies chords in any voicing and inversion', () => {
    expect(identifyChord([60, 64, 67])).toMatchObject({ name: 'C', quality: 'major', inversion: 'root position' })
    expect(identifyChord([64, 67, 72])).toMatchObject({ name: 'C/E', inversion: '1st inversion' })
    expect(identifyChord([57, 60, 64])).toMatchObject({ name: 'Am' })
    expect(identifyChord([55, 59, 62, 65])).toMatchObject({ name: 'G7' })
    expect(identifyChord([60, 64, 67])!.tones.map((t) => t.role)).toEqual(['root', 'major 3rd', 'perfect 5th'])
  })
  it('gives roman numerals in a key', () => {
    const k = parseKey('C major')!
    expect(romanNumeral(k.root, k.minor, 7, 'major')).toBe('V')
    expect(romanNumeral(k.root, k.minor, 9, 'minor')).toBe('vi')
  })
  it('names intervals', () => {
    expect(intervalName(7)).toBe('perfect 5th')
    expect(intervalName(12)).toBe('octave')
  })
  it('chord builder voicings stay on a 25-key MiniLab (48–72)', () => {
    for (let root = 0; root < 12; root++) for (const iv of [[0, 4, 7], [0, 3, 7, 10], [0, 4, 7, 11]]) for (let inv = 0; inv < iv.length; inv++) {
      const v = voicing(root, iv, inv)
      expect(Math.min(...v)).toBeGreaterThanOrEqual(48)
      expect(Math.max(...v)).toBeLessThanOrEqual(72)
    }
  })
})
