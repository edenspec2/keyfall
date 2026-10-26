import { useEffect, useReducer, useState } from 'react'
import { midi } from '../midi/midiInput'

/** Re-render when MIDI devices or permission state change. */
export function useMidiStatus() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => midi.onChange(bump), [])
  return midi
}

/** Currently held pitches, sorted. Re-renders on key events only (not per frame). */
export function useHeld(): number[] {
  const [held, setHeld] = useState<number[]>(() => [...midi.held.keys()].sort((a, b) => a - b))
  useEffect(() => midi.on(() => setHeld([...midi.held.keys()].sort((a, b) => a - b))), [])
  return held
}

/** Re-render at a fixed rate (for logs and meters that change faster than React should care about). */
export function useTicker(ms: number) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => { const id = setInterval(bump, ms); return () => clearInterval(id) }, [ms])
}
