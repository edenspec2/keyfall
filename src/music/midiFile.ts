import { DRUMS, gmToDrum, PAD_PITCH } from './drums'
import type { NoteEvent } from './types'

export const PPQ = 480

const vlq = (n: number) => {
  const bytes = [n & 0x7f]
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80)
  return bytes
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const str = (s: string) => [...s].map((c) => c.charCodeAt(0))

function trackChunk(events: { tick: number; bytes: number[] }[]) {
  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]) // note-offs (0x8n) before note-ons (0x9n) at equal ticks
  const data: number[] = []
  let last = 0
  for (const e of events) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick }
  data.push(0, 0xff, 0x2f, 0) // end of track
  return [...str('MTrk'), ...u32(data.length), ...data]
}

/** Standard MIDI File, format 1: a tempo track plus one track per part (channel = part index; drum parts on channel 10, GM drum notes). */
export function toMidiFile(tracks: { name: string; notes: NoteEvent[]; drums?: boolean }[], bpm: number, timeSig: [number, number] = [4, 4]): Uint8Array {
  const usPerQ = Math.round(60_000_000 / bpm)
  const tempo = trackChunk([
    { tick: 0, bytes: [0xff, 0x51, 3, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255] },
    { tick: 0, bytes: [0xff, 0x58, 4, timeSig[0], Math.log2(timeSig[1]), 24, 8] },
  ])
  const parts = tracks.map((t, i) => {
    const ch = t.drums ? 9 : i % 16 === 9 ? 10 : i % 16 // channel 10 (index 9) is reserved for drums
    const name = str(t.name).slice(0, 100)
    const ev: { tick: number; bytes: number[] }[] = [{ tick: 0, bytes: [0xff, 0x03, name.length, ...name] }]
    for (const n of t.notes) {
      const on = Math.max(0, Math.round(n.start * PPQ)), off = Math.max(on + 1, Math.round((n.start + n.dur) * PPQ))
      const p = n.drum !== undefined ? DRUMS[n.drum].gm : n.pitch & 127
      ev.push({ tick: on, bytes: [0x90 | ch, p, Math.max(1, Math.min(127, n.vel ?? 80))] })
      ev.push({ tick: off, bytes: [0x80 | ch, p, 0] })
    }
    return trackChunk(ev)
  })
  const header = [...str('MThd'), ...u32(6), 0, 1, 0, tracks.length + 1, (PPQ >> 8) & 255, PPQ & 255]
  return new Uint8Array([...header, ...tempo, ...parts.flat()])
}

/** Minimal reader (used by tests and for future MIDI import): returns notes per track and the first tempo. */
export function parseMidiFile(buf: Uint8Array): { bpm: number; ppq: number; tracks: NoteEvent[][] } {
  let i = 0
  const rd = (n: number) => { let v = 0; for (let k = 0; k < n; k++) v = (v << 8) | buf[i++]; return v >>> 0 }
  const rv = () => { let v = 0, b; do { b = buf[i++]; v = (v << 7) | (b & 0x7f) } while (b & 0x80); return v }
  if (String.fromCharCode(...buf.slice(0, 4)) !== 'MThd') throw new Error('Not a MIDI file')
  i = 8
  rd(2); const ntr = rd(2); const ppq = rd(2)
  let bpm = 120
  const tracks: NoteEvent[][] = []
  for (let t = 0; t < ntr; t++) {
    if (String.fromCharCode(...buf.slice(i, i + 4)) !== 'MTrk') throw new Error('Bad track chunk')
    i += 4
    const end = rd(4) + i
    let tick = 0, status = 0
    const open = new Map<number, { start: number; vel: number }>()
    const notes: NoteEvent[] = []
    while (i < end) {
      tick += rv()
      let b = buf[i]
      if (b & 0x80) { status = b; i++ } else b = status
      const type = status & 0xf0
      if (status === 0xff) {
        const meta = buf[i++]; const len = rv()
        if (meta === 0x51) bpm = Math.round(60_000_000 / ((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]))
        i += len
      } else if (status === 0xf0 || status === 0xf7) i += rv()
      else if (type === 0x90 || type === 0x80) {
        const p = buf[i++], v = buf[i++]
        if (type === 0x90 && v > 0) open.set(p, { start: tick, vel: v })
        else {
          const o = open.get(p)
          if (o) {
            const n: NoteEvent = { pitch: p, start: o.start / ppq, dur: (tick - o.start) / ppq, vel: o.vel, hand: p < 60 ? 'L' : 'R' }
            if ((status & 0x0f) === 9) { n.drum = gmToDrum(p); n.pitch = PAD_PITCH + n.drum; n.hand = 'L' } // channel 10 = drums
            notes.push(n); open.delete(p)
          }
        }
      } else i += type === 0xc0 || type === 0xd0 ? 1 : 2
    }
    tracks.push(notes.sort((a, b) => a.start - b.start))
  }
  return { bpm, ppq, tracks }
}
