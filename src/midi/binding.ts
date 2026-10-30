// A button on the MIDI keyboard taught to do something: a key, a pad or a CC button.
import { noteNameOct } from '../music/theory'
import type { CCEvent, InputEvent } from './midiInput'

export type Binding = { channel: number; cc?: number; note?: number; pad?: number }

export const sameControl = (a: Binding, b: Binding) => a.channel === b.channel && a.cc === b.cc && a.note === b.note && a.pad === b.pad
export const bindingName = (b: Binding) => `${b.cc !== undefined ? `CC ${b.cc}` : b.pad !== undefined ? `Pad ${b.pad + 1}` : noteNameOct(b.note!)} · ch ${b.channel}`

/** The control a key or pad press is, or null for anything else. */
export const bindingOf = (e: InputEvent): Binding | null =>
  e.type === 'on' ? { channel: e.channel, note: e.pitch } : e.type === 'pad' ? { channel: e.channel, pad: e.pad } : null

/** CC buttons send a value while held: a press is the step up from 0, not every step of a turning knob. */
export function ccPresses() {
  const last = new Map<string, number>()
  return (e: CCEvent): Binding | null => {
    const k = `${e.channel}:${e.cc}`, was = last.get(k) ?? 0
    last.set(k, e.raw)
    return e.raw > 0 && was === 0 ? { channel: e.channel, cc: e.cc } : null
  }
}
