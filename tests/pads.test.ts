import { describe, expect, it } from 'vitest'
import { Session, type AudioOut } from '../src/engine/session'
import { Recorder } from '../src/engine/recorder'
import { PAD_PITCH } from '../src/music/drums'
import { parseMidiFile, toMidiFile } from '../src/music/midiFile'
import type { Lesson, NoteEvent } from '../src/music/types'
import { mergeTake, newComposition } from '../src/ui/Create'

function rig() {
  let t = 10
  const drums: { k: number; time: number }[] = []
  const out: AudioOut = {
    now: () => t, heard: () => t, schedule() {}, metronome() {}, panic() {},
    drum: (k, time) => { drums.push({ k, time }) },
  }
  return { out, drums, run: (s: Session, sec: number) => { for (let i = 0; i < sec * 60; i++) { t += 1 / 60; s.tick() } } }
}
const hit = (drum: number, start: number, hand: 'L' | 'R' = 'L'): NoteEvent => ({ pitch: PAD_PITCH + drum, drum, start, dur: 0.25, hand })
const beat: Lesson = {
  id: 'b', stage: 7, kind: 'play', title: '', goal: '', intro: [], bpm: 60, timeSig: [4, 4], hands: 'both',
  notes: [hit(0, 0), hit(2, 0, 'R'), hit(1, 1), hit(2, 1, 'R')], pass: { minAccuracy: 0.8 },
}
const pad = (k: number) => ({ type: 'pad' as const, pad: k, vel: 100, channel: 10, time: performance.now(), source: 't' })

describe('pads in lessons', () => {
  it('scores pad hits like keys, in time', () => {
    const r = rig(); const s = new Session(beat, { mode: 'rhythm', hands: 'both', bpm: 60, metronome: false, loop: null, calibration: 0 }, r.out)
    s.start(); r.run(s, 4)
    expect(s.input(pad(0))?.ok).toBe(true)
    expect(s.input(pad(2))?.ok).toBe(true)
    expect(s.input(pad(5))?.ok).toBe(false) // wrong drum
    r.run(s, 1); s.input(pad(1)); s.input(pad(2)); r.run(s, 3)
    expect(s.scorer.summary().accuracy).toBe(1)
  })
  it('plays the other hand\'s drums through the kit', () => {
    const r = rig(); const s = new Session(beat, { mode: 'wait', hands: 'L', bpm: 60, metronome: false, loop: null, calibration: 0 }, r.out)
    s.start(); r.run(s, 2.5)
    s.input(pad(0)); r.run(s, 0.3)
    expect(r.drums.map((d) => d.k)).toContain(2) // right-hand hi-hat auto-played
  })
  it('counts touch-strip bends and vibrato during a jam', () => {
    const r = rig()
    const jam: Lesson = { ...beat, kind: 'improvise', hands: 'R', notes: [{ pitch: 48, start: 0, dur: 4, hand: 'L' }], scale: [0, 2, 4, 7, 9] }
    const s = new Session(jam, { mode: 'watch', hands: 'R', bpm: 60, metronome: false, loop: null, calibration: 0 }, r.out)
    s.start(); r.run(s, 4.2)
    const ev = (type: 'bend' | 'mod', value: number) => ({ type, value, channel: 1, time: performance.now(), source: 't' })
    for (const v of [0, 0.4, 0.8, 1, 0.3, 0, 0.9, 0]) s.input(ev('bend', v))
    s.input(ev('mod', 0.6)); s.input(ev('mod', 0))
    expect(s.improvSummary()).toMatchObject({ bends: 2, vibrato: 1 })
  })
})

describe('pads in Create', () => {
  it('records pad hits as drum notes and routes them to the drum track', () => {
    const rec = new Recorder((ms) => ms / 1000)
    rec.input({ type: 'on', pitch: 60, vel: 80, channel: 1, time: 0, source: 't' })
    rec.input({ ...pad(1), time: 250 }); rec.input({ ...pad(0), time: 500 })
    rec.input({ type: 'off', pitch: 60, channel: 1, time: 1000, source: 't' })
    const c = mergeTake(newComposition(), 0, rec.stop(2000))
    expect(c.tracks).toHaveLength(2)
    expect(c.tracks[0].notes.map((n) => n.pitch)).toEqual([60])
    expect(c.tracks[1]).toMatchObject({ name: 'Drums', drums: true })
    expect(c.tracks[1].notes.map((n) => n.drum)).toEqual([1, 0])
  })
  it('exports drums on channel 10 with General MIDI notes and reads them back as drums', () => {
    const drums = [hit(0, 0), hit(1, 1), hit(2, 0.5), hit(7, 3)]
    const bytes = toMidiFile([{ name: 'Keys', notes: [{ pitch: 60, start: 0, dur: 1, hand: 'R' }] }, { name: 'Drums', notes: drums, drums: true }], 100)
    expect([...bytes].some((b, i) => b === 0x99 && bytes[i + 1] === 36)).toBe(true) // Note On, channel 10, kick
    const back = parseMidiFile(bytes).tracks[2]
    expect(back.map((n) => n.drum)).toEqual([0, 2, 1, 7])
    expect(back.every((n) => n.pitch === PAD_PITCH + n.drum!)).toBe(true)
  })
})
