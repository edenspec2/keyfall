// Music theory helpers. Pure functions.
import { DRUMS, PAD_PITCH } from './drums'

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

export const pc = (pitch: number) => ((pitch % 12) + 12) % 12
export const octaveOf = (pitch: number) => Math.floor(pitch / 12) - 1 // 60 → 4
export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pc(pitch))
export const noteName = (pitch: number, flats = false) => (pitch >= PAD_PITCH ? DRUMS[pitch - PAD_PITCH]?.name ?? 'Pad' : (flats ? FLAT_NAMES : SHARP_NAMES)[pc(pitch)])
export const noteNameOct = (pitch: number, flats = false) => (pitch >= PAD_PITCH ? noteName(pitch) : noteName(pitch, flats) + octaveOf(pitch))
/** Tone.js wants ASCII names: C#4 */
export const toneName = (pitch: number) => SHARP_NAMES[pc(pitch)].replace('♯', '#') + octaveOf(pitch)

export const INTERVALS = [
  'unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th',
  'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th', 'octave',
]
export const intervalName = (semitones: number) => {
  const s = Math.abs(semitones)
  return s <= 12 ? INTERVALS[s] : `${INTERVALS[s % 12 || 12]} + ${Math.floor((s - 1) / 12)} oct`
}

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
}
export const scalePcs = (rootPc: number, scale: string) => SCALES[scale].map((i) => (i + rootPc) % 12)

interface ChordShape { suffix: string; quality: string; intervals: number[]; why: string }
const CHORDS: ChordShape[] = [
  { suffix: '', quality: 'major', intervals: [0, 4, 7], why: 'A major third (4 semitones) on the bottom with a minor third on top gives the bright, stable sound.' },
  { suffix: 'm', quality: 'minor', intervals: [0, 3, 7], why: 'A minor third (3 semitones) on the bottom with a major third on top – the lowered third makes it sound darker.' },
  { suffix: 'dim', quality: 'diminished', intervals: [0, 3, 6], why: 'Two stacked minor thirds squeeze the fifth down to a tritone, so it sounds tense and wants to resolve.' },
  { suffix: 'aug', quality: 'augmented', intervals: [0, 4, 8], why: 'Two stacked major thirds push the fifth up – dreamy and unstable.' },
  { suffix: 'sus4', quality: 'suspended 4th', intervals: [0, 5, 7], why: 'The third is replaced by a 4th, so it is neither major nor minor – it hangs and wants to fall to the third.' },
  { suffix: 'sus2', quality: 'suspended 2nd', intervals: [0, 2, 7], why: 'The third is replaced by a 2nd – open, airy, undecided.' },
  { suffix: '7', quality: 'dominant 7th', intervals: [0, 4, 7, 10], why: 'A major triad plus a minor 7th: the tritone between the 3rd and 7th pulls strongly home to the tonic.' },
  { suffix: 'maj7', quality: 'major 7th', intervals: [0, 4, 7, 11], why: 'A major triad plus a major 7th – soft, jazzy, a little wistful.' },
  { suffix: 'm7', quality: 'minor 7th', intervals: [0, 3, 7, 10], why: 'A minor triad plus a minor 7th – mellow and smooth.' },
  { suffix: '5', quality: 'power chord', intervals: [0, 7], why: 'Just root and fifth – no third, so it is neither major nor minor.' },
]
const DEGREE_NAMES: Record<number, string> = {
  0: 'root', 2: '2nd', 3: 'minor 3rd', 4: 'major 3rd', 5: '4th', 6: 'diminished 5th', 7: 'perfect 5th',
  8: 'augmented 5th', 10: 'minor 7th', 11: 'major 7th',
}

export interface ChordInfo {
  name: string // "C", "Am/C"
  root: number // pitch class
  quality: string
  why: string
  tones: { pitch: number; name: string; role: string }[]
  inversion: 'root position' | '1st inversion' | '2nd inversion' | '3rd inversion'
}

/** Identify a chord from held pitches (any octave, any voicing). Returns null if no known shape matches. */
export function identifyChord(pitches: number[]): ChordInfo | null {
  const sorted = [...new Set(pitches)].sort((a, b) => a - b)
  const pcs = [...new Set(sorted.map(pc))]
  if (pcs.length < 2) return null
  const bass = pc(sorted[0])
  // Prefer a root equal to the bass note (root position) before trying inversions.
  const roots = [bass, ...pcs.filter((p) => p !== bass)]
  for (const root of roots) {
    const rel = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b)
    const shape = CHORDS.find((c) => c.intervals.length === rel.length && c.intervals.every((v, i) => v === rel[i]))
    if (!shape) continue
    const bassInterval = (bass - root + 12) % 12
    const invIndex = shape.intervals.indexOf(bassInterval)
    const inversion = (['root position', '1st inversion', '2nd inversion', '3rd inversion'] as const)[invIndex]
    const rootName = noteName(root)
    return {
      name: rootName + shape.suffix + (bassInterval ? '/' + noteName(bass) : ''),
      root,
      quality: shape.quality,
      why: shape.why,
      inversion,
      tones: sorted.map((p) => ({ pitch: p, name: noteName(p), role: DEGREE_NAMES[(pc(p) - root + 12) % 12] ?? '?' })),
    }
  }
  return null
}

/** Roman numeral of a chord root in a major/minor key, e.g. ('C', major, G) → 'V'. */
export function romanNumeral(keyRootPc: number, minor: boolean, chordRootPc: number, chordQuality: string): string | null {
  const degrees = minor ? SCALES['natural minor'] : SCALES.major
  const deg = degrees.indexOf((chordRootPc - keyRootPc + 12) % 12)
  if (deg < 0) return null
  const r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][deg]
  if (chordQuality.startsWith('minor')) return r.toLowerCase()
  if (chordQuality === 'diminished') return r.toLowerCase() + '°'
  return r
}

/** Parse "C major" / "A minor" / "F♯ minor" into root pitch class + minor flag. */
export function parseKey(key: string): { root: number; minor: boolean } | null {
  const m = key.match(/^([A-G])([♯#b♭]?)\s*(major|minor)/i)
  if (!m) return null
  let root = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C']
  if (m[2] === '♯' || m[2] === '#') root += 1
  if (m[2] === 'b' || m[2] === '♭') root -= 1
  return { root: (root + 12) % 12, minor: m[3].toLowerCase() === 'minor' }
}

/** Detect the most likely major key for a set of pitch classes (for improvisation hints). */
export function guessKey(pcs: number[]): string | null {
  if (pcs.length < 3) return null
  let best = -1, bestRoot = 0
  for (let r = 0; r < 12; r++) {
    const s = scalePcs(r, 'major')
    const score = pcs.filter((p) => s.includes(p)).length
    if (score > best) { best = score; bestRoot = r }
  }
  return best === pcs.length ? `${noteName(bestRoot)} major` : null
}
