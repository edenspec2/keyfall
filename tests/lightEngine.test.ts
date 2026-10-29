import { describe, expect, it, vi } from 'vitest'

// Like audioStart.test.ts, but every constructed node is its own stand-in that remembers what it connects to,
// so the light engine's wiring (the whole phone fix) can be checked.
interface Rec { kind: string; to: unknown[]; cut: boolean; disposed?: boolean; opts?: Record<string, number> }
const any: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : any), set: () => true, apply: () => any, construct: () => any })
const made = vi.hoisted(() => ({ nodes: [] as { rec: Rec; self: unknown }[] }))
vi.mock('tone', () => {
  const kind = (name: string) => function (opts?: Record<string, number>) {
    const rec: Rec = { kind: name, to: [], cut: false, opts }
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
  const names = ['Synth', 'Limiter', 'Compressor', 'WaveShaper', 'StereoWidener', 'Reverb', 'FeedbackDelay', 'Volume', 'Tremolo', 'Gain', 'Phaser', 'Chorus', 'EQ3', 'Filter',
    'Distortion', 'Vibrato', 'Sampler', 'PolySynth', 'FMSynth', 'AMSynth', 'MembraneSynth', 'NoiseSynth', 'MetalSynth']
  return {
    ...Object.fromEntries(names.map((n) => [n, kind(n)])),
    getDestination: () => any, immediate: () => 0,
    connect: (a: { connected?: unknown[] }, b: unknown) => { (a.connected ??= []).push(b) }, // Tone.connect, for the native synth's output
    // The native synth builds browser nodes from the raw context: stand-ins that accept every call.
    getContext: () => ({ close: () => Promise.resolve(), rawContext: { currentTime: 0, state: 'suspended', resume: () => Promise.resolve(), createGain: () => ({ gain: any, connect: any, disconnect: any }), createOscillator: () => any, createPeriodicWave: () => any } }),
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
    // The browser's compressor takes attack and release only up to 1 s; Tone throws above that and the engine
    // never finished building (a 1.2 s release left the phone silent).
    for (const c of of('Compressor')) expect([c.rec.opts?.attack, c.rec.opts?.release].every((v) => v === undefined || (v >= 0 && v <= 1))).toBe(true)
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
    // Vibrato: built on first use. A synth already playing (e-piano) is moved onto it; the piano never goes through it.
    audio.instrument = 'epiano'
    audio.noteOn(64, 90); audio.noteOff(64)
    const epiano = (audio as unknown as { voices: Map<string, { output: { connected?: unknown[]; disconnect: unknown } }> }).voices.get('epiano')!
    expect(of('Vibrato').length).toBe(0)
    audio.setMod(0.5)
    expect(of('Vibrato').length).toBe(1)
    const vib = of('Vibrato')[0]
    expect(epiano.output.connected?.at(-1)).toBe(vib.self) // re-plugged into the vibrato
    expect(vib.rec.to.includes(of('Gain')[0].self)).toBe(true) // into the chain input
    audio.setMod(0); audio.setMod(0.2)
    expect(of('Vibrato').length).toBe(1) // built once
    audio.instrument = 'piano'
    vi.unstubAllGlobals()
  })
})

describe('trimTail (phone piano samples)', () => {
  it('keeps stereo, cuts where the note has faded 45 dB, fades the cut, and respects 2.5 s and maxSec', async () => {
    const { trimTail } = await import('../src/audio/audioEngine')
    const buf = (ch: Float32Array[]) => ({ length: ch[0].length, sampleRate: 4, numberOfChannels: ch.length, getChannelData: (i: number) => ch[i] })
    const ctx = { createBuffer: (n: number, len: number) => buf(Array.from({ length: n }, () => new Float32Array(len))) }
    // 20 s at 4 Hz: a strike of 1, a ring of 0.1 until 10 s, then -60 dB (below the -45 dB floor).
    const note = (k: number) => Float32Array.from({ length: 80 }, (_, i) => k * (i < 4 ? 1 : i < 40 ? 0.1 : 0.001))
    const out = trimTail(ctx as never, buf([note(1), note(0.5)]) as never)
    expect(out.numberOfChannels).toBe(2) // no mono sum: the two mics are far apart, summing cancelled 1.4-4 dB
    expect(out.length).toBe(40) // cut where the ring falls below the floor
    expect(Array.from(out.getChannelData(0).slice(32))).toEqual([0.1, 0.1, 0.1, 0.1, 0.1, 0.075, 0.05, 0.025].map((v) => Math.fround(v)))
    expect(out.getChannelData(1)[10]).toBeCloseTo(0.05) // right channel kept as recorded
    expect(trimTail(ctx as never, buf([note(1)]) as never, -45, 5).length).toBe(20) // capped at maxSec
    const quick = Float32Array.from({ length: 80 }, (_, i) => (i < 4 ? 1 : 0))
    expect(trimTail(ctx as never, buf([quick]) as never).length).toBe(10) // never shorter than 2.5 s
    const short = buf([new Float32Array(6).fill(1)])
    expect(trimTail(ctx as never, short as never)).toBe(short) // nothing to cut: the recording itself
  })
})

describe('pickLayer (piano touch layers)', () => {
  it('plays the highest loaded layer the velocity reaches, else the medium recordings', async () => {
    const { pickLayer } = await import('../src/audio/audioEngine')
    const layers = [{ from: 1, ready: true, s: 'soft' }, { from: 49, ready: true, s: 'medium' }, { from: 97, ready: true, s: 'hard' }]
    expect([1, 48, 49, 96, 97, 127].map((v) => pickLayer(layers, v, 'medium'))).toEqual(['soft', 'soft', 'medium', 'medium', 'hard', 'hard'])
    // Phones have no soft layer, and the hard one is used only once all its notes have loaded.
    const phone = [{ from: 49, ready: false, s: 'medium' }, { from: 97, ready: false, s: 'hard' }]
    expect([20, 100].map((v) => pickLayer(phone, v, 'medium'))).toEqual(['medium', 'medium'])
    phone[1].ready = true
    expect([20, 60, 100].map((v) => pickLayer(phone, v, 'medium'))).toEqual(['medium', 'medium', 'hard'])
  })
})
