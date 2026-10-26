import { describe, expect, it } from 'vitest'
import { Session, type AudioOut, type SessionOptions } from '../src/engine/session'
import type { Lesson } from '../src/music/types'

function rig() {
  let t = 10
  const scheduled: { pitch: number; time: number }[] = []
  const clicks: number[] = []
  const out: AudioOut = {
    now: () => t,
    heard: () => t, // fake: no output latency
    schedule: (pitch, time) => { scheduled.push({ pitch, time }) },
    metronome: (time) => { clicks.push(time) },
    panic: () => {},
  }
  return { out, scheduled, clicks, advance: (s: number) => { t += s }, get t() { return t } }
}

const lesson: Lesson = {
  id: 't', stage: 1, kind: 'play', title: 'T', goal: '', intro: [], bpm: 60, timeSig: [4, 4], hands: 'R',
  pass: { minAccuracy: 0.8 },
  notes: [
    { pitch: 60, start: 0, dur: 1, hand: 'R' },
    { pitch: 48, start: 0, dur: 2, hand: 'L' },
    { pitch: 62, start: 1, dur: 1, hand: 'R' },
    { pitch: 64, start: 2, dur: 2, hand: 'R' },
  ],
}
const opts = (o: Partial<SessionOptions>): SessionOptions => ({ mode: 'wait', hands: 'R', bpm: 60, metronome: false, loop: null, calibration: 0, ...o })
const on = (pitch: number) => ({ type: 'on' as const, pitch, vel: 90, channel: 1, time: 0, source: 'test' })

/** Run the frame loop for `sec` seconds at 60 fps. */
function run(r: ReturnType<typeof rig>, s: Session, sec: number) {
  for (let i = 0; i < Math.round(sec * 60); i++) { r.advance(1 / 60); s.tick() }
}

describe('Session', () => {
  it('Wait mode stops on each chord and advances only on the right keys', () => {
    const r = rig(); const s = new Session(lesson, opts({ mode: 'wait' }), r.out)
    s.start() // 2-beat lead-in
    run(r, s, 3)
    expect(s.state).toBe('waiting')
    expect(s.transport.beat).toBe(0)
    expect(r.scheduled.map((x) => x.pitch)).not.toContain(48) // other hand waits with the user
    s.input(on(61)) // wrong
    run(r, s, 1)
    expect(s.state).toBe('waiting')
    s.input(on(60))
    expect(s.state).toBe('playing')
    run(r, s, 0.2)
    expect(r.scheduled.map((x) => x.pitch)).toContain(48)
    run(r, s, 1)
    expect(s.transport.beat).toBe(1) // waiting on D
    s.input(on(62)); run(r, s, 1.2); s.input(on(64)); run(r, s, 4)
    expect(s.state).toBe('done')
    expect(s.scorer.summary().accuracy).toBe(1)
    expect(s.scorer.summary().extras).toBe(1)
  })

  it('pause and resume keep notes in sync with the clock', () => {
    const r = rig(); const s = new Session(lesson, opts({ mode: 'watch' }), r.out)
    s.start(); run(r, s, 2.5) // beat 0.5
    s.pause(); r.advance(5); s.resume()
    const beatAfter = s.transport.beat
    run(r, s, 1)
    expect(s.transport.beat).toBeCloseTo(beatAfter + 1, 1)
    // Every scheduled note's audio time matches its beat on the transport.
    const d = r.scheduled.find((x) => x.pitch === 62)!
    expect(s.transport.beatAt(d.time)).toBeCloseTo(1, 2)
  })

  it('Loop mode wraps exactly and scores each pass', () => {
    const r = rig()
    const s = new Session(lesson, opts({ mode: 'loop', loop: [0, 4] }), r.out)
    s.start() // 4-beat count-in
    run(r, s, 4)
    const startAudio = s.transport.timeOf(0)
    run(r, s, 4 * 20 + 0.5) // 20 passes
    expect(s.passes.length).toBe(20)
    // After 20 wraps the anchor is still exactly periodic: beat 0 of the current pass is a whole number of loops later.
    const loops = (s.transport.timeOf(0) - startAudio) / 4
    expect(Math.abs(loops - Math.round(loops))).toBeLessThan(1e-9)
  })

  it('Rhythm mode scores against the clock and finishes', () => {
    const r = rig(); const s = new Session(lesson, opts({ mode: 'rhythm' }), r.out)
    let done = false; s.onDone = () => { done = true }
    s.start(); run(r, s, 4) // count-in ends at beat 0
    s.input(on(60)); run(r, s, 1.05); s.input(on(62)); run(r, s, 6)
    expect(done).toBe(true)
    const sum = s.scorer.summary()
    expect(sum.hits).toBe(2)
    expect(sum.missed).toBe(1)
    expect(r.clicks.length).toBeGreaterThanOrEqual(4) // count-in clicks
  })
})

describe('Session after a stall', () => {
  it('skips notes and clicks that are already in the past instead of firing them all at once', () => {
    const r = rig()
    const s = new Session(lesson, opts({ mode: 'watch', metronome: true }), r.out)
    s.start(); r.advance(1 / 60); s.tick()
    const before = { notes: r.scheduled.length, clicks: r.clicks.length }
    r.advance(10) // tab hidden for 10 s: no frames
    s.tick()
    expect(r.scheduled.slice(before.notes).filter((x) => x.time < r.t - 0.5)).toHaveLength(0)
    expect(r.clicks.slice(before.clicks).filter((t) => t < r.t - 0.1)).toHaveLength(0)
  })
})
