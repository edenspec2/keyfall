import { describe, expect, it, vi } from 'vitest'

// Like audioStart.test.ts, but every constructed node is its own stand-in that remembers what it connects to,
// so the light engine's wiring (the whole phone fix) can be checked.
interface Rec { kind: string; to: unknown[]; cut: boolean; disposed?: boolean }
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
        if (k === 'dispose') return () => { rec.disposed = true; return self }
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
  it('sends keys and drums through the phone bus to the limiter and builds no effects', async () => {
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'pianoapp.v1.engine' ? 'light' : null), setItem: () => {} })
    const { audio } = await import('../src/audio/audioEngine')
    await audio.start()
    expect(audio.light).toBe(true)
    const of = (k: string) => made.nodes.filter((n) => n.rec.kind === k)
    // Compressors in build order: the limiter, then the phone bus.
    expect(of('Compressor').length).toBe(2)
    const [lim, lift] = of('Compressor')
    expect(of('Gain').some((g) => lift.rec.to.includes(g.self) && g.rec.to.includes(lim.self))).toBe(true)
    const vols = of('Volume').filter((n) => n.rec.to.includes(lift.self))
    expect(vols.length).toBe(2) // keys and drums
    // Notes reach the keys volume through the filter only.
    expect(of('Filter').some((f) => f.rec.to.some((t) => vols.some((v) => v.self === t)))).toBe(true)
    // A Tone object costs audio-thread time just by existing: none of these may be built on a phone,
    // and the click and drums wait for first use.
    const heavy = ['Phaser', 'Chorus', 'Tremolo', 'StereoWidener', 'Reverb', 'FeedbackDelay', 'Vibrato', 'Distortion', 'EQ3', 'MetalSynth', 'MembraneSynth', 'NoiseSynth', 'Synth']
    expect(heavy.filter((k) => of(k).length)).toEqual([])
    // Drums are built on first hit, and even then with noise hats, never a MetalSynth.
    vi.useFakeTimers()
    audio.drum(2, 0, 100, 'standard')
    audio.drum(4, 0, 100, 'kirtan')
    const built = made.nodes.length
    expect(of('MembraneSynth').length).toBeGreaterThan(0)
    expect(of('MetalSynth').length).toBe(0)
    // After 30 silent seconds every kit node is disposed, and the next hit builds a fresh kit.
    vi.advanceTimersByTime(29_000)
    expect(of('MembraneSynth').some((n) => n.rec.disposed)).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(of('MembraneSynth').every((n) => n.rec.disposed)).toBe(true)
    expect(of('NoiseSynth').every((n) => n.rec.disposed)).toBe(true)
    audio.drum(0, 0, 100, 'standard')
    expect(made.nodes.length).toBeGreaterThan(built)
    expect(of('MembraneSynth').some((n) => !n.rec.disposed)).toBe(true)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})

describe('shorten (phone piano samples)', () => {
  it('keeps the first seconds as mono and fades out the cut', async () => {
    const { shorten } = await import('../src/audio/audioEngine')
    const buf = (ch: Float32Array[]) => ({ length: ch[0].length, sampleRate: 4, numberOfChannels: ch.length, getChannelData: (i: number) => ch[i] })
    const ctx = { createBuffer: (_n: number, len: number) => buf([new Float32Array(len)]) }
    const long = buf([new Float32Array(40).fill(1), new Float32Array(40).fill(0.5)]) // 10 s at 4 Hz, stereo
    const out = shorten(ctx as never, long as never, 2) // 2 s = 8 samples
    expect(out.length).toBe(8)
    expect(Array.from(out.getChannelData(0))).toEqual([0.75, 0.75, 0.75, 0.75, 0.75, 0.75 * 3 / 4, 0.75 / 2, 0.75 / 4])
    const short = shorten(ctx as never, buf([new Float32Array(4).fill(1)]) as never, 2) // shorter than 2 s: untouched
    expect(Array.from(short.getChannelData(0))).toEqual([1, 1, 1, 1])
  })
})
