import { describe, expect, it } from 'vitest'
import { Session, type AudioOut } from '../src/engine/session'
import type { Lesson, NoteEvent } from '../src/music/types'
import { mergeTake, newComposition } from '../src/ui/Create'

function rig() {
  let t = 10
  const played: { pitch: number; time: number; instrument?: string }[] = []
  const out: AudioOut = {
    now: () => t, heard: () => t,
    schedule: (pitch, time, _d, _v, instrument) => { played.push({ pitch, time, instrument }) },
    metronome: () => {}, panic: () => {},
  }
  return { out, played, run: (s: Session, sec: number) => { for (let i = 0; i < sec * 60; i++) { t += 1 / 60; s.tick() } } }
}
const song = (notes: NoteEvent[]): Lesson => ({ id: 'c', stage: 6, kind: 'play', title: 'C', goal: '', intro: [], bpm: 60, timeSig: [4, 4], notes, hands: 'R', pass: { minAccuracy: 0 }, countIn: 0 })
const opts = { mode: 'watch' as const, hands: 'R' as const, bpm: 60, metronome: false, loop: null, calibration: 0 }

describe('Create jam loop', () => {
  it('Loop repeats the song in whole bars, each note with its track sound', () => {
    const r = rig()
    const s = new Session(song([{ pitch: 60, start: 0, dur: 1, hand: 'R', instrument: 'strings' }, { pitch: 64, start: 1, dur: 1, hand: 'R' }]), { ...opts, repeat: true }, r.out)
    s.start(); r.run(s, 10.5) // 60 BPM, a 2-beat song rounds up to one 4-beat bar: 3 passes in 10.5 s
    const cs = r.played.filter((p) => p.pitch === 60)
    expect(cs.length).toBe(3)
    expect(cs.every((p) => p.instrument === 'strings')).toBe(true)
    expect(r.played.find((p) => p.pitch === 64)?.instrument).toBeUndefined() // no track sound: the player's sound
    expect(cs[1].time - cs[0].time).toBeCloseTo(4, 2) // one bar apart, no drift
    expect(s.state).toBe('playing')
  })

  it('Loop on an empty song does not spin: it just ends', () => {
    const r = rig()
    const s = new Session(song([]), { ...opts, repeat: true }, r.out)
    s.start(); r.run(s, 2)
    expect(s.state).toBe('done')
  })

  it("a track's first take takes the live sound; later takes keep the track's sound", () => {
    const take: NoteEvent[] = [{ pitch: 60, start: 0, dur: 1, hand: 'R' }]
    const first = mergeTake(newComposition(), 0, take, 'harmonium')
    expect(first.tracks[0].instrument).toBe('harmonium')
    const second = mergeTake(first, 0, take, 'synth')
    expect(second.tracks[0].instrument).toBe('harmonium')
  })
})
