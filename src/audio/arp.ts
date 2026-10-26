// Arpeggiator and chord-memory note logic (pure, so it is testable without audio).

export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'played'
export const ARP_MODES: { id: ArpMode; label: string }[] = [
  { id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }, { id: 'updown', label: 'Up/Down' }, { id: 'random', label: 'Random' }, { id: 'played', label: 'As played' },
]
export const ARP_RATES = [{ label: '1/4', beats: 1 }, { label: '1/8', beats: 0.5 }, { label: '1/8T', beats: 1 / 3 }, { label: '1/16', beats: 0.25 }, { label: '1/16T', beats: 1 / 6 }, { label: '1/32', beats: 0.125 }]

export interface ArpSettings { on: boolean; mode: ArpMode; rate: number; octaves: number; gate: number; latch: boolean }
export interface ChordSettings { on: boolean; shape: number[] }

/**
 * One cycle of the arpeggio. `played` is the held notes in the order they were pressed.
 * Random returns the ascending pool; the player picks from it each step.
 */
export function arpPattern(played: number[], mode: ArpMode, octaves: number): number[] {
  const base = mode === 'played' ? [...new Set(played)] : [...new Set(played)].sort((a, b) => a - b)
  const up: number[] = []
  for (let o = 0; o < Math.max(1, Math.min(3, octaves)); o++) for (const p of base) if (p + 12 * o <= 127) up.push(p + 12 * o)
  if (mode === 'down') return up.reverse()
  // Up/down doesn't repeat the top and bottom notes: C E G E | C E G E
  if (mode === 'updown') return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up
  return up
}

/** Next random index, avoiding the same note twice in a row when there is a choice. */
export function randomStep(len: number, prev: number, rand = Math.random) {
  if (len <= 1) return 0
  const i = Math.floor(rand() * (len - 1))
  return i >= prev ? i + 1 : i
}

/** Chord shape as intervals above its lowest note: [60, 64, 67] → [0, 4, 7]. */
export function chordShape(held: number[]): number[] {
  const s = [...new Set(held)].sort((a, b) => a - b)
  return s.map((p) => p - s[0])
}
/** The remembered shape played from `root`, dropping notes beyond MIDI range. */
export const transposeShape = (shape: number[], root: number) => (shape.length ? shape : [0]).map((i) => root + i).filter((p) => p >= 0 && p <= 127)
