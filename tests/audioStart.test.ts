import { describe, expect, it, vi } from 'vitest'

// A do-anything stand-in for every Tone node: any property or call returns itself, so the engine can build its graph in Node.
const node: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : node), apply: () => node, construct: () => node })
const made = vi.hoisted(() => ({ contexts: 0, closed: 0 }))
vi.mock('tone', () => {
  const names = ['Synth', 'Limiter', 'Compressor', 'StereoWidener', 'Reverb', 'FeedbackDelay', 'Volume', 'Tremolo', 'Gain', 'Phaser', 'Chorus', 'EQ3', 'Filter',
    'Distortion', 'Vibrato', 'Sampler', 'PolySynth', 'FMSynth', 'AMSynth', 'MembraneSynth', 'NoiseSynth', 'MetalSynth', 'getDestination', 'immediate']
  return {
    ...Object.fromEntries(names.map((n) => [n, node])),
    Context: function () { made.contexts++; return node },
    getContext: () => ({ close: () => { made.closed++; return Promise.resolve() }, rawContext: { currentTime: 0 } }),
    setContext: () => {},
    start: () => new Promise((r) => setTimeout(r, 5)), // resumes asynchronously, like the browser
  }
})

describe('audio.start', () => {
  it('builds one context and one chain when called twice at once (double first click)', async () => {
    vi.stubGlobal('window', globalThis)
    const { audio } = await import('../src/audio/audioEngine')
    const a = audio.start(), b = audio.start()
    expect(a).toBe(b)
    await Promise.all([a, b, audio.start()])
    expect(made.contexts).toBe(1)
    expect(made.closed).toBe(1) // the default pre-click context is closed
    expect(audio.started).toBe(true)
    vi.unstubAllGlobals()
  })
})
