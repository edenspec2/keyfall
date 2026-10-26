import { describe, expect, it } from 'vitest'
import { quantize, Recorder } from '../src/engine/recorder'
import { parseMidiFile, toMidiFile } from '../src/music/midiFile'
import type { NoteEvent } from '../src/music/types'

const ev = (type: 'on' | 'off', pitch: number, time: number) =>
  type === 'on' ? { type, pitch, vel: 70, channel: 1, time, source: 't' } as const : { type, pitch, channel: 1, time, source: 't' } as const

describe('Recorder', () => {
  // 120 bpm, take starts at perf time 1000 ms → beat = (ms - 1000) / 500
  const toBeat = (ms: number) => (ms - 1000) / 500

  it('preserves onsets and durations, including overlapping notes', () => {
    const r = new Recorder(toBeat)
    r.input(ev('on', 60, 1000)); r.input(ev('on', 64, 1250))
    r.input(ev('off', 60, 1500)); r.input(ev('off', 64, 2000))
    const take = r.stop(2500)
    expect(take).toEqual([
      { pitch: 60, start: 0, dur: 1, vel: 70, hand: 'R' },
      { pitch: 64, start: 0.5, dur: 1.5, vel: 70, hand: 'R' },
    ])
  })

  it('extends notes held by the sustain pedal until it is lifted', () => {
    const r = new Recorder(toBeat)
    r.input({ type: 'sustain', down: true, channel: 1, time: 900, source: 't' })
    r.input(ev('on', 48, 1000)); r.input(ev('off', 48, 1100))
    r.input({ type: 'sustain', down: false, channel: 1, time: 3000, source: 't' })
    expect(r.stop(4000)[0].dur).toBe(4)
  })

  it('closes notes still held when recording stops', () => {
    const r = new Recorder(toBeat)
    r.input(ev('on', 62, 1500))
    expect(r.stop(2500)[0]).toMatchObject({ start: 1, dur: 2 })
  })
})

describe('quantize', () => {
  it('snaps to the grid, fully or partially', () => {
    const notes: NoteEvent[] = [{ pitch: 60, start: 0.93, dur: 0.4, hand: 'R' }]
    expect(quantize(notes, 0.5)[0]).toMatchObject({ start: 1, dur: 0.5 })
    expect(quantize(notes, 0.5, 0.5)[0].start).toBeCloseTo(0.965)
  })
})

describe('MIDI export', () => {
  it('writes a valid file whose notes and timing read back exactly', () => {
    const notes: NoteEvent[] = [
      { pitch: 60, start: 0, dur: 1, vel: 90, hand: 'R' },
      { pitch: 64, start: 0, dur: 1, vel: 80, hand: 'R' },
      { pitch: 60, start: 1, dur: 0.5, vel: 100, hand: 'R' }, // repeated pitch right after its note-off
      { pitch: 48, start: 2.25, dur: 1.75, vel: 60, hand: 'L' },
    ]
    const bytes = toMidiFile([{ name: 'Piano', notes }], 96)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
    const back = parseMidiFile(bytes)
    expect(back.bpm).toBe(96)
    expect(back.tracks).toHaveLength(2) // tempo + piano
    const sort = (a: NoteEvent[]) => [...a].sort((x, y) => x.start - y.start || x.pitch - y.pitch)
    expect(sort(back.tracks[1]).map(({ pitch, start, dur, vel }) => ({ pitch, start, dur, vel })))
      .toEqual(sort(notes).map(({ pitch, start, dur, vel }) => ({ pitch, start, dur, vel })))
  })
})
