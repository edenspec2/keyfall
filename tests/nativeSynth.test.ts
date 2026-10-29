import { describe, expect, it, vi } from 'vitest'

vi.mock('tone', () => ({ connect: () => {} }))
import { NativeSynth, noteHz, type Patch } from '../src/audio/nativeSynth'

// A fake audio context that records every node and automation call.
type Call = [string, ...unknown[]]
function fakeCtx() {
  const made: Record<string, unknown>[] = []
  const param = (value = 0) => { const p = { value, calls: [] as Call[] }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'exponentialRampToValueAtTime', 'cancelAndHoldAtTime']) (p as Record<string, unknown>)[m] = (...a: unknown[]) => { p.calls.push([m, ...a]) }; return p }
  const node = (kind: string, extra: Record<string, unknown>) => {
    const n: Record<string, unknown> = { kind, to: [] as unknown[], disconnected: false, ...extra }
    n.connect = (d: unknown) => { (n.to as unknown[]).push(d); return d }
    n.disconnect = () => { n.disconnected = true }
    made.push(n)
    return n
  }
  const ctx = {
    currentTime: 0,
    createGain: () => node('gain', { gain: param(1) }),
    createOscillator: () => node('osc', { type: 'sine', wave: null, frequency: param(440), detune: param(0), started: -1, stopped: -1, setPeriodicWave(w: unknown) { this.wave = w }, start(t: number) { this.started = t }, stop(t: number) { this.stopped = t } }),
    createPeriodicWave: () => ({}),
  }
  return { ctx: ctx as unknown as BaseAudioContext, made }
}
const base: Patch = { kind: 'osc', type: 'sawtooth', count: 1, spread: 0, harmonicity: 3, modulationIndex: 0, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }, volume: -20, portamento: 0 }
const oscs = (made: Record<string, unknown>[]) => made.filter((n) => n.kind === 'osc') as unknown as { frequency: { calls: Call[] }; detune: { calls: Call[] }; started: number; stopped: number; type: string; onended?: () => void }[]
const lastSet = (calls: Call[]) => calls.filter((c) => c[0] === 'setValueAtTime').at(-1)?.[1]

describe('NativeSynth', () => {
  it('reads note names and MIDI numbers', () => {
    expect(noteHz('A4')).toBe(440)
    expect(noteHz(69)).toBe(440)
    expect(noteHz('C4')).toBeCloseTo(261.626, 2)
    expect(noteHz('C#4')).toBeCloseTo(noteHz('Db4'), 6)
    expect(noteHz('Bb3')).toBeCloseTo(233.082, 2)
    expect(() => noteHz('H2')).toThrow()
  })

  it('stacks detuned copies like a fat oscillator, at its level, and follows pitch bend', () => {
    const { ctx, made } = fakeCtx()
    const s = new NativeSynth(ctx, { ...base, count: 3, spread: 20 })
    s.set({ detune: 50 })
    s.triggerAttack('A4', 1, 0.8)
    const o = oscs(made)
    expect(o.map((x) => lastSet(x.detune.calls))).toEqual([40, 50, 60]) // -10, 0, +10 cents around the bend
    expect(o.every((x) => x.started === 1 && lastSet(x.frequency.calls) === 440)).toBe(true)
    const amp = made.find((n) => n.kind === 'gain' && (n.to as unknown[]).includes(s.output)) as { gain: { calls: Call[] } }
    const peak = amp.gain.calls.find((c) => c[0] === 'linearRampToValueAtTime')![1] as number
    expect(peak).toBeCloseTo(0.8 * 10 ** ((-6 - 3 * 1.1) / 20), 6) // each copy at -6 - 1.1·count dB
    s.set({ detune: -100 })
    expect(o.map((x) => lastSet(x.detune.calls))).toEqual([-110, -100, -90]) // reaches notes already sounding
  })

  it('FM: a square modulator at harmonicity × pitch, swinging the carrier by pitch × index', () => {
    const { ctx, made } = fakeCtx()
    const s = new NativeSynth(ctx, { ...base, kind: 'fm', type: 'sine', modulationIndex: 6 })
    s.triggerAttack('A4', 0, 1)
    const [carrier, mod] = oscs(made)
    expect(carrier.type).toBe('sine')
    expect(mod.type).toBe('square')
    expect(lastSet(mod.frequency.calls)).toBe(1320)
    const depth = made.find((n) => n.kind === 'gain' && (n.to as unknown[]).includes(carrier.frequency)) as { gain: { value: number } }
    expect(depth.gain.value).toBe(440 * 6)
  })

  it('releases one copy of a note (the oldest), stops it after the release, and forgets it once ended', () => {
    const { ctx, made } = fakeCtx()
    const s = new NativeSynth(ctx, base)
    s.triggerAttack('C4', 0, 1)
    s.triggerAttack('C4', 0.5, 1)
    s.triggerRelease('C4', 1)
    const [first, second] = oscs(made)
    expect(first.stopped).toBeCloseTo(1 + 0.3 + 0.05, 6)
    expect(second.stopped).toBe(-1) // the second C4 still sounds
    first.onended!()
    expect(made.filter((n) => n.disconnected).length).toBe(2) // its oscillator and gain are unplugged
    s.releaseAll(2)
    expect(second.stopped).toBeCloseTo(2.35, 6)
    second.onended!()
    s.releaseAll(3) // nothing left to release
    expect(second.stopped).toBeCloseTo(2.35, 6)
  })

  it('past the voice limit, the oldest note is released', () => {
    const { ctx, made } = fakeCtx()
    const s = new NativeSynth(ctx, base)
    s.maxPolyphony = 2
    s.triggerAttack('C4', 0, 1); s.triggerAttack('E4', 0, 1); s.triggerAttack('G4', 0.1, 1)
    expect(oscs(made).map((o) => o.stopped > 0)).toEqual([true, false, false])
  })
})
