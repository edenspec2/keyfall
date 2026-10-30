import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/audio/audioEngine', () => ({ audio: {} }))
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
import { finish, MAX_SEC, Take } from '../src/audio/padSamples'

const RATE = 1000 // samples per second: small numbers, same logic
const chunk = (level: number, n = 100) => new Float32Array(n).fill(level) // 0.1 s
const feed = (t: Take, levels: number[]) => levels.map((l) => t.push(chunk(l)))

describe('pad sample takes', () => {
  it('waits for a sound, keeps 0.1 s from before it, and ends after 0.7 s of quiet', () => {
    const t = new Take(RATE)
    const states = feed(t, [0.001, 0.001, 0.001, 0.5, 0.5, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001])
    expect(states.slice(0, 3)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(states[3]).toBe('recording')
    expect(states.at(-1)).toBe('done') // 7 quiet chunks = 0.7 s
    const out = t.result()!
    expect(out.length).toBeGreaterThanOrEqual(200) // the loud part, trimmed of the silence around it
    expect(out.length).toBeLessThan(220)
    expect(Math.max(...out)).toBeCloseTo(0.9, 6) // brought to -1 dB
  })

  it('stops at the length limit and gives up when nothing is heard', () => {
    const long = new Take(RATE)
    expect(feed(long, Array(MAX_SEC * 10).fill(0.5)).at(-1)).toBe('done')
    const silent = new Take(RATE)
    expect(feed(silent, Array(100).fill(0.001)).at(-1)).toBe('done') // 10 s
    expect(silent.result()).toBeNull()
  })

  it('trims, caps, and fades the edges so the sound starts and ends without a click', () => {
    const d = new Float32Array(3000)
    d.fill(0.4, 1000, 2500)
    const out = finish(d, RATE, 1)!
    expect(out.length).toBe(1000) // capped at 1 s
    expect(out[0]).toBe(0) // faded in from silence (5 ms of lead-in)
    expect(out.at(-1)).toBe(0) // faded out
    expect(finish(new Float32Array(500), RATE, 1)).toBeNull() // nothing there
  })
})
