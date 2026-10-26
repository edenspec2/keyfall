import type { NoteEvent } from './types'
import { noteName, pc, SCALES } from './theory'

/** Best-fitting major key (by duration-weighted pitch classes), with a nudge toward the first/last note as tonic. */
export function detectKey(notes: NoteEvent[]): { root: number; name: string; fit: number } | null {
  if (notes.length < 3) return null
  const w = new Array(12).fill(0)
  for (const n of notes) w[pc(n.pitch)] += n.dur
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const total = w.reduce((a, b) => a + b, 0)
  let best = { root: 0, score: -1 }
  for (let r = 0; r < 12; r++) {
    const s = SCALES.major.map((i) => (i + r) % 12)
    let score = s.reduce((a, p) => a + w[p], 0) / total
    if (pc(sorted[0].pitch) === r) score += 0.03
    if (pc(sorted[sorted.length - 1].pitch) === r) score += 0.05
    if (score > best.score) best = { root: r, score }
  }
  return { root: best.root, name: `${noteName(best.root)} major`, fit: Math.min(1, best.score) }
}

const DIATONIC = [
  { deg: 0, roman: 'I', iv: [0, 4, 7], suffix: '' },
  { deg: 2, roman: 'ii', iv: [0, 3, 7], suffix: 'm' },
  { deg: 4, roman: 'iii', iv: [0, 3, 7], suffix: 'm' },
  { deg: 5, roman: 'IV', iv: [0, 4, 7], suffix: '' },
  { deg: 7, roman: 'V', iv: [0, 4, 7], suffix: '' },
  { deg: 9, roman: 'vi', iv: [0, 3, 7], suffix: 'm' },
]

/**
 * One chord per bar that harmonises the melody: the diatonic triad covering the most melody time,
 * favouring strong beats, I at the start and end, and V before a final I.
 */
export function suggestChords(melody: NoteEvent[], keyRoot: number, beatsPerBar: number) {
  const bars = Math.max(1, Math.ceil(Math.max(0, ...melody.map((n) => n.start + n.dur)) / beatsPerBar))
  const out: { bar: number; name: string; roman: string; pcs: number[] }[] = []
  const lastNote = [...melody].sort((x, y) => x.start - y.start).at(-1) ?? { pitch: keyRoot }
  for (let b = 0; b < bars; b++) {
    const a = b * beatsPerBar, z = a + beatsPerBar
    const scores = DIATONIC.map((c, ci) => {
      const pcs = c.iv.map((i) => (i + c.deg + keyRoot) % 12)
      let s = 0
      for (const n of melody) {
        const overlap = Math.min(z, n.start + n.dur) - Math.max(a, n.start)
        if (overlap <= 0) continue
        const strong = n.start >= a && (n.start - a) % 2 === 0 ? 1.5 : 1
        s += pcs.includes(pc(n.pitch)) ? overlap * strong : -0.3 * overlap
      }
      if (b === 0 && ci === 0) s += 0.6
      if (b === bars - 1 && ci === 0 && pcs.includes(pc(lastNote.pitch))) s += 0.6 // end on I only if the tune does
      if (ci === 0 || ci === 3 || ci === 4) s += 0.25 // primary chords first: easiest to hear and to play
      if (b === bars - 2 && ci === 4) s += 0.4
      if (ci === 2) s -= 0.2 // iii is rarely the most natural choice for beginners
      return { c, pcs, s }
    })
    const best = scores.sort((x, y) => y.s - x.s)[0]
    out.push({ bar: b, name: noteName((best.c.deg + keyRoot) % 12) + best.c.suffix, roman: best.c.roman, pcs: best.pcs })
  }
  return out
}

/** Left-hand accompaniment for the suggestions: close triads in C3–B3 (48–59), half notes. */
export function accompaniment(chords: { bar: number; pcs: number[] }[], beatsPerBar: number): NoteEvent[] {
  const notes: NoteEvent[] = []
  for (const c of chords) {
    const voiced = c.pcs.map((p) => 48 + p).sort((a, b) => a - b)
    const hits = beatsPerBar % 2 === 0 ? [0, beatsPerBar / 2] : [0]
    const len = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar
    for (const h of hits) for (const p of voiced) notes.push({ pitch: p, start: c.bar * beatsPerBar + h, dur: len, hand: 'L', vel: 60 })
  }
  return notes
}
