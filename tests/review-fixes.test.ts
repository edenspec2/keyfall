import { describe, expect, it } from 'vitest'
import { Session, type AudioOut, type SessionOptions } from '../src/engine/session'
import type { Lesson, NoteEvent } from '../src/music/types'

/** Fake audio clock. `latency` = how far behind the speakers are (heard = now - latency). */
function rig(latency = 0) {
  let t = 10
  const scheduled: { pitch: number; time: number }[] = []
  const clicks: number[] = []
  const out: AudioOut = {
    now: () => t,
    heard: (perfMs) => t - latency + (perfMs - performance.now()) / 1000,
    schedule: (pitch, time) => { scheduled.push({ pitch, time }) },
    metronome: (time) => { clicks.push(time) },
    panic: () => {},
  }
  return { out, scheduled, clicks, advance: (s: number) => { t += s }, get t() { return t } }
}
type Rig = ReturnType<typeof rig>
const run = (r: Rig, s: Session, sec: number) => { for (let i = 0; i < Math.round(sec * 120); i++) { r.advance(1 / 120); s.tick() } }
const on = (pitch: number) => ({ type: 'on' as const, pitch, vel: 90, channel: 1, time: performance.now(), source: 't' })
const off = (pitch: number) => ({ type: 'off' as const, pitch, channel: 1, time: performance.now(), source: 't' })
const opts = (o: Partial<SessionOptions>): SessionOptions => ({ mode: 'rhythm', hands: 'R', bpm: 60, metronome: false, loop: null, calibration: 0, ...o })

const scale: NoteEvent[] = [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => ({ pitch: p, start: i, dur: 1, hand: 'R' }))
const lesson = (o: Partial<Lesson> = {}): Lesson => ({ id: 'x', stage: 3, kind: 'play', title: '', goal: '', intro: [], bpm: 60, timeSig: [4, 4], notes: scale, hands: 'R', pass: { minAccuracy: 0.9 }, ...o })

describe('reviewer fixes', () => {
  it('scores against what the player hears: 150 ms output latency does not turn late notes into misses', () => {
    const r = rig(0.15); const s = new Session(lesson(), opts({}), r.out)
    s.start()
    run(r, s, 4 + 0.15 + 0.2) // count-in, + latency, + 200 ms late for the first note
    expect(s.input(on(60))?.grade).toBe('late')
  })

  it('Loop: an early press on the downbeat counts for the next pass', () => {
    const r = rig(); const s = new Session(lesson(), opts({ mode: 'loop', loop: [0, 4] }), r.out)
    s.start(); run(r, s, 4) // count-in → beat 0
    for (let pass = 0; pass < 2; pass++) {
      for (const [i, p] of [60, 62, 64, 65].entries()) {
        run(r, s, i === 0 ? 0 : 0.95) // presses 50 ms early from the 2nd note on, incl. the next downbeat
        s.input(on(p)); run(r, s, 0.05); s.input(off(p))
      }
      run(r, s, 0.9)
    }
    run(r, s, 1)
    expect(s.passes.length).toBeGreaterThanOrEqual(2)
    for (const p of s.passes.slice(0, 2)) { expect(p.accuracy).toBe(1); expect(p.extras).toBe(0) }
  })

  it('Loop count-in clicks even when the loop starts in bar 3', () => {
    const r = rig(); const s = new Session(lesson({ notes: [...scale, ...scale.map((n) => ({ ...n, start: n.start + 8 }))] }), opts({ mode: 'loop', loop: [8, 12] }), r.out)
    s.start(); run(r, s, 3.9)
    expect(r.clicks.length).toBe(4)
  })

  it('Resume rewinds a beat without turning replayed notes into extras', () => {
    const r = rig(); const s = new Session(lesson(), opts({}), r.out)
    s.start(); run(r, s, 4)
    s.input(on(60)); run(r, s, 0.5); s.input(off(60)); run(r, s, 0.4)
    s.pause(); s.resume() // rewinds to ~beat -0.1
    run(r, s, 0.1); s.input(on(60)); s.input(off(60)) // the player replays the C
    expect(s.scorer.wrong).toHaveLength(0)
  })

  it('jam backing: the loop downbeat is scheduled ahead, exactly one loop later', () => {
    const backing: NoteEvent[] = [{ pitch: 48, start: 0, dur: 2, hand: 'L' }, { pitch: 55, start: 2, dur: 2, hand: 'L' }]
    const r = rig(); const s = new Session(lesson({ kind: 'improvise', notes: backing, scale: [0, 2, 4, 7, 9] }), opts({ mode: 'watch' }), r.out)
    s.start(); run(r, s, 4 + 4 * 3 + 0.5)
    const downbeats = r.scheduled.filter((x) => x.pitch === 48).map((x) => x.time)
    expect(downbeats.length).toBe(4)
    const gaps = downbeats.slice(1).map((t, i) => t - downbeats[i])
    for (const g of gaps) expect(g).toBeCloseTo(4, 9)
  })

  it('Create: a note goes quiet the moment its track is muted, mid-song', () => {
    let muted = false
    const notes = [60, 62, 64, 65].map((p, i): NoteEvent => Object.defineProperty({ pitch: p, start: i, dur: 1, hand: 'R' }, 'silent', { get: () => muted }))
    const r = rig(); const s = new Session(lesson({ notes, countIn: 0 }), opts({ mode: 'watch' }), r.out)
    s.start(); run(r, s, 1.5); muted = true; run(r, s, 3)
    expect(r.scheduled.map((x) => x.pitch)).toEqual([60, 62]) // 62 was already scheduled ahead when the mute came
  })

  it('a run only counts at the slowest tempo used', () => {
    const r = rig(); const s = new Session(lesson(), opts({ bpm: 40 }), r.out)
    s.start(); run(r, s, 1); s.setBpm(60)
    expect(s.minBpm).toBe(40)
  })
})
