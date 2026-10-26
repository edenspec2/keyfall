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
