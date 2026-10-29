import { describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ t: 0, played: [] as { pitch: number; time: number; dur: number }[] }))
vi.mock('../src/audio/audioEngine', () => ({
  audio: {
    performFx: true, bpm: 120, instrument: 'piano', now: () => fake.t, noteOn: () => {}, noteOff: () => {},
    schedule: (pitch: number, time: number, dur: number) => { fake.played.push({ pitch, time, dur }) },
  },
}))
vi.stubGlobal('window', { setInterval: () => 1 })
import { perform } from '../src/audio/perform'

describe('arpeggiator swing', () => {
  it('delays every second step by swing × a third of a step, and ends it before the next step', () => {
    // 120 BPM in 1/8 notes: a step is 0.25 s. Full swing puts the off-beat a third of a step late (a triplet shuffle).
    perform.configure({ on: true, mode: 'up', rate: 1, octaves: 1, gate: 1, latch: false, swing: 1 }, { on: false, shape: [0] })
    perform.noteOn(60, 90)
    perform.noteOn(64, 90)
    const tick = () => (perform as unknown as { tick: () => void }).tick()
    for (const t of [0.2, 0.45]) { fake.t = t; tick() }
    const [a, b, c] = fake.played
    expect(a).toEqual({ pitch: 60, time: 0, dur: 0.25 })
    expect(b.pitch).toBe(64)
    expect(b.time).toBeCloseTo(0.25 + 0.25 / 3, 9)
    expect(b.dur).toBeCloseTo(0.25 - 0.25 / 3, 9) // stops as the next on-beat note starts
    expect(c.time).toBeCloseTo(0.5, 9) // on-beat steps stay on the grid
  })
})
