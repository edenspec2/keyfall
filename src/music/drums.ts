// The drum kit played by the MiniLab pads (and by drum notes in lessons and compositions).

/** Drum hits live on "pitches" above the MIDI range so the scorer and renderer can treat them like keys without clashing. */
export const PAD_PITCH = 200

export const DRUMS = [
  { name: 'Kick', short: 'K', gm: 36, color: '#ff6a8a' },
  { name: 'Snare', short: 'S', gm: 38, color: '#ffb35e' },
  { name: 'Closed hat', short: 'H', gm: 42, color: '#5ec8ff' },
  { name: 'Open hat', short: 'O', gm: 46, color: '#7ce0ff' },
  { name: 'Clap', short: 'C', gm: 39, color: '#ffe066' },
  { name: 'Low tom', short: 'T', gm: 45, color: '#a98bff' },
  { name: 'High tom', short: 't', gm: 48, color: '#c3a9ff' },
  { name: 'Crash', short: 'X', gm: 49, color: '#5df2a0' },
]

/** Kirtan kit: dholak strokes, hand cymbals and bells. GM notes are the nearest General MIDI percussion for export. */
export const KIRTAN_DRUMS = [
  { name: 'Ge (dholak bass)', short: 'Ge', gm: 64, color: '#ff8a5c' },
  { name: 'Na (dholak open)', short: 'Na', gm: 63, color: '#ffb35e' },
  { name: 'Tin (dholak closed)', short: 'Ti', gm: 62, color: '#ffd28a' },
  { name: 'Ka (slap)', short: 'Ka', gm: 37, color: '#e0a3ff' },
  { name: 'Kartals', short: 'Kt', gm: 54, color: '#ffe066' },
  { name: 'Manjira', short: 'Mj', gm: 81, color: '#5df2a0' },
  { name: 'Ghungroo', short: 'Gh', gm: 70, color: '#7ce0ff' },
  { name: 'Khol (deep)', short: 'Kh', gm: 60, color: '#ff6a8a' },
]
export type Kit = 'standard' | 'kirtan'
/** The kit the pads and drum notes play right now (set from Settings, and by kirtan lessons while they're open). */
export const kit: { id: Kit } = { id: 'standard' }
export const currentDrums = () => (kit.id === 'kirtan' ? KIRTAN_DRUMS : DRUMS)

/** General MIDI drum note → nearest drum of our kit (for importing channel-10 parts). */
export function gmToDrum(n: number): number {
  const exact = DRUMS.findIndex((d) => d.gm === n)
  if (exact >= 0) return exact
  if (n <= 36) return 0
  if (n === 37 || n === 40) return 1
  if (n === 44) return 2
  if (n === 41 || n === 43) return 5
  if (n === 47 || n === 50) return 6
  return 7 // cymbals and percussion
}

export const isDrum = (pitch: number) => pitch >= PAD_PITCH
export const drumOf = (pitch: number) => pitch - PAD_PITCH
