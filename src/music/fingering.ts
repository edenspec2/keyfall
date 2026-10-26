import { isBlack } from './theory'
import type { Hand, NoteEvent } from './types'

export interface FingerSpot { pitch: number; finger: number; hand: Hand }

const whiteStep = (p: number, dir: number) => { let q = p + dir; while (isBlack(q)) q += dir; return q }

/** Right hand: higher finger = higher key. Left hand: higher finger = lower key. */
const fits = (hand: Hand, at: Map<number, number>, f: number, p: number) =>
  [...at].every(([f2, p2]) => p !== p2 && Math.sign(f - f2) === (hand === 'R' ? 1 : -1) * Math.sign(p - p2))

/**
 * Where each finger of `hand` should rest for the next passage (from the first upcoming fingered note, `span` beats long).
 * Fingers are read from the lesson in order until the hand has to move (a finger lands out of order); fingers the
 * passage doesn't use are placed on the neighbouring white keys, so the whole hand shape is shown.
 */
export function handPosition(notes: NoteEvent[], hand: Hand, beat: number, span: number): FingerSpot[] {
  const up = notes.filter((n) => n.hand === hand && n.finger && n.start + n.dur > beat).sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  if (!up.length) return []
  const at = new Map<number, number>() // finger → pitch
  for (const n of up) {
    if (n.start >= up[0].start + span) break
    if (at.get(n.finger!) === n.pitch) continue
    if (at.has(n.finger!) || !fits(hand, at, n.finger!, n.pitch)) break // the hand shifts here
    at.set(n.finger!, n.pitch)
  }
  const known = [...at]
  for (let f = 1; f <= 5; f++) {
    if (at.has(f)) continue
    const [k, p] = known.reduce((a, b) => (Math.abs(b[0] - f) < Math.abs(a[0] - f) ? b : a))
    let q = p
    for (let i = 0; i < Math.abs(f - k); i++) q = whiteStep(q, Math.sign(f - k) * (hand === 'R' ? 1 : -1))
    if (fits(hand, at, f, q)) at.set(f, q)
  }
  return [...at].map(([finger, pitch]) => ({ pitch, finger, hand }))
}
