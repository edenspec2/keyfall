import { describe, expect, it, vi } from 'vitest'

// Like audioStart.test.ts, but every constructed node is its own stand-in that remembers what it connects to,
// so the light engine's wiring (the whole phone fix) can be checked.
interface Rec { kind: string; to: unknown[]; cut: boolean }
const any: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : any), set: () => true, apply: () => any, construct: () => any })
const made = vi.hoisted(() => ({ nodes: [] as { rec: Rec; self: unknown }[] }))
vi.mock('tone', () => {
  const kind = (name: string) => function () {
    const rec: Rec = { kind: name, to: [], cut: false }
    const self: any = new Proxy(function () {}, {
      get: (_t, k) => {
        if (k === 'then') return undefined
        if (k === 'connect') return (x: unknown) => { rec.to.push(x); return self }
        if (k === 'disconnect') return (x?: unknown) => { if (x === undefined) rec.cut = true; return self }
        if (k === 'toDestination' || k === 'start') return () => self
        return any
      },
      set: () => true,
    })
    made.nodes.push({ rec, self })
    return self
  }
  const names = ['Synth', 'Limiter', 'Compressor', 'StereoWidener', 'Reverb', 'FeedbackDelay', 'Volume', 'Tremolo', 'Gain', 'Phaser', 'Chorus', 'EQ3', 'Filter',
    'Distortion', 'Vibrato', 'Sampler', 'PolySynth', 'FMSynth', 'AMSynth', 'MembraneSynth', 'NoiseSynth', 'MetalSynth']
  return {
    ...Object.fromEntries(names.map((n) => [n, kind(n)])),
    getDestination: () => any, immediate: () => 0,
    getContext: () => ({ close: () => Promise.resolve(), rawContext: { currentTime: 0, state: 'suspended', resume: () => Promise.resolve() } }),
    setContext: () => {},
    start: () => Promise.resolve(),
  }
})

describe('light engine (phones)', () => {
  it('sends keys and drums straight to the limiter and leaves the effects unfed', async () => {
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'pianoapp.v1.engine' ? 'light' : null), setItem: () => {} })
    const { audio } = await import('../src/audio/audioEngine')
    await audio.start()
    expect(audio.light).toBe(true)
    const of = (k: string) => made.nodes.filter((n) => n.rec.kind === k)
    const limiter = of('Limiter')[0].self
    const vols = of('Volume').filter((n) => n.rec.to.includes(limiter))
    expect(vols.length).toBeGreaterThanOrEqual(2) // keys and drums
    // Notes reach the keys volume through the filter only.
    expect(of('Filter').some((f) => f.rec.to.some((t) => vols.some((v) => v.self === t)))).toBe(true)
    // Nothing feeds the delay → reverb → widener branch, and the compressor that ends it is unplugged.
    const delay = of('FeedbackDelay')[0].self
    expect(made.nodes.some((n) => n.rec.to.includes(delay))).toBe(false)
    expect(of('Compressor')[0].rec.cut).toBe(true)
    vi.unstubAllGlobals()
  })
})
