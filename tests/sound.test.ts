import { afterEach, describe, expect, it, vi } from 'vitest'
import { arpPattern, chordShape, randomStep, transposeShape } from '../src/audio/arp'
import { ccFor, clearCC, decodeCC, detectEncoding, getParam, handleCC, learn, loadPreset, mapCC, relDelta, saveUserPreset, setCCMode, setParam, WIZARD, deleteUserPreset, renameUserPreset, allPresets, currentParams } from '../src/audio/controls'
import { defaults, effective, FACTORY_PRESETS, fromNorm, PARAM_IDS, PARAMS, resolve, toNorm, type Params } from '../src/audio/sound'
import { MidiInput, parseMessage, type CCEvent, type InputEvent } from '../src/midi/midiInput'
import { ccMap, settings, sound, userPresets } from '../src/store/store'

afterEach(() => { vi.unstubAllGlobals(); learn.arm(null) })

describe('CC parsing', () => {
  it('turns knob/fader Control Changes into cc events, keeping mod and sustain as before', () => {
    expect(parseMessage([0xb1, 74, 100], 3, 'p')).toEqual({ type: 'cc', cc: 74, value: 100 / 127, raw: 100, channel: 2, time: 3, source: 'p' })
    expect(parseMessage([0xb0, 1, 127], 1, 'p')).toMatchObject({ type: 'mod' })
    expect(parseMessage([0xb0, 64, 127], 1, 'p')).toMatchObject({ type: 'sustain' })
    expect(parseMessage([0xb0, 123, 0], 1, 'p')).toBeNull() // All Notes Off is a mode message, not a knob
  })
  it('sends CCs to onCC only: the scorer/recorder stream never sees them, and keys/pads never reach onCC', async () => {
    const port: any = { id: 'b', name: 'Minilab3 MIDI', state: 'connected', connection: 'open', onmidimessage: null, open: () => Promise.resolve() }
    const access: any = { inputs: new Map([['b', port]]), onstatechange: null }
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve(access) })
    const m = new MidiInput()
    await m.connect()
    const keys: InputEvent[] = [], ccs: CCEvent[] = []
    m.on((e) => keys.push(e)); m.onCC((e) => ccs.push(e))
    const send = (b: number[]) => port.onmidimessage({ data: new Uint8Array(b), timeStamp: 1 })
    send([0xb0, 74, 65]); send([0x90, 60, 90]); send([0x99, 36, 90]); send([0xb5, 18, 3])
    expect(ccs.map((e) => [e.cc, e.raw])).toEqual([[74, 65], [18, 3]])
    expect(keys.map((e) => e.type)).toEqual(['on', 'pad'])
  })
})

describe('relative / absolute decoding', () => {
  it('decodes binary-offset and two\'s-complement steps', () => {
    expect(relDelta(65, 'rel64')).toBe(1); expect(relDelta(61, 'rel64')).toBe(-3)
    expect(relDelta(2, 'twos')).toBe(2); expect(relDelta(127, 'twos')).toBe(-1); expect(relDelta(121, 'twos')).toBe(-7)
  })
  it('auto-detects relative encoders from repeated values around 64 or 1–7 / 121–127', () => {
    expect(detectEncoding([65, 65])).toBe('rel64')
    expect(detectEncoding([63, 63, 62])).toBe('rel64')
    expect(detectEncoding([1, 1, 2])).toBe('twos')
    expect(detectEncoding([127, 127])).toBe('twos')
  })
  it('treats sweeps and out-of-band values as absolute, and waits when it cannot tell', () => {
    expect(detectEncoding([10, 11, 12])).toBe('abs')
    expect(detectEncoding([60, 61, 62, 63])).toBe('abs') // an absolute knob passing through the middle
    expect(detectEncoding([64, 65])).toBeNull()
    expect(detectEncoding([])).toBeNull()
  })
  it('moves the knob position: absolute jumps, relative steps and clamps', () => {
    expect(decodeCC(0.2, 127, 'abs')).toBe(1)
    expect(decodeCC(0.5, 66, 'rel64')).toBeCloseTo(0.5 + 2 / 64)
    expect(decodeCC(0.99, 7, 'twos')).toBe(1)
    expect(decodeCC(0.01, 121, 'twos')).toBe(0)
    expect(decodeCC(0.5, 65, null)).toBeNull()
  })
})

describe('macros', () => {
  const at = (id: keyof Params, v: number, inst: 'piano' | 'epiano' | 'strings' | 'synth' = 'synth') => effective({ ...defaults(inst), [id]: v }, inst)
  const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
  const mono = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1])
  it('leave the designed sound untouched at their default (0.5)', () => {
    for (const inst of ['piano', 'epiano', 'strings', 'synth'] as const) {
      const d = defaults(inst), e = effective(d, inst)
      expect(e.cutoff).toBe(d.cutoff); expect(e.attack).toBeCloseTo(d.attack); expect(e.release).toBeCloseTo(d.release)
      expect(e.reverbDecay).toBeCloseTo(d.reverbDecay); expect(e.chorus).toBe(d.chorus); expect(e.eqHigh).toBe(d.eqHigh); expect(e.drive).toBe(d.drive)
    }
  })
  it('are monotonic and stay inside the parameter ranges', () => {
    const base = { ...defaults('synth'), cutoff: 2000 }
    const b = steps.map((v) => effective({ ...base, brightness: v }, 'synth'))
    expect(mono(b.map((e) => e.cutoff))).toBe(true); expect(mono(b.map((e) => e.eqHigh))).toBe(true)
    expect(b[0].cutoff).toBeGreaterThanOrEqual(40); expect(at('brightness', 1).cutoff).toBe(20000)
    const t = steps.map((v) => at('time', v))
    for (const k of ['attack', 'release', 'reverbDecay'] as const) expect(mono(t.map((e) => e[k]))).toBe(true)
    const mv = steps.map((v) => at('movement', v))
    for (const k of ['chorus', 'phaser', 'lfoRate'] as const) expect(mono(mv.map((e) => e[k]))).toBe(true)
    expect(mv[6].chorus).toBeLessThanOrEqual(1); expect(mv[6].phaser).toBeLessThanOrEqual(1)
    expect(mono(steps.map((v) => at('movement', v, 'epiano').tremolo))).toBe(true)
    expect(mono(steps.map((v) => at('timbre', v, 'epiano').modIndex))).toBe(true)
    expect(mono(steps.map((v) => at('timbre', v, 'piano').drive))).toBe(true)
    expect(mono(steps.map((v) => at('timbre', v, 'strings').harmonicity))).toBe(true)
    expect(at('timbre', 1, 'piano').drive).toBeLessThanOrEqual(1)
  })
  it('knob scaling round-trips and clamps; stepped params snap', () => {
    for (const id of PARAM_IDS) {
      const s = PARAMS[id]
      expect(fromNorm(id, toNorm(id, s.def))).toBeCloseTo(s.def)
      expect(fromNorm(id, -1)).toBe(s.min); expect(fromNorm(id, 2)).toBe(s.max)
    }
    expect(fromNorm('delayDiv', 0.49)).toBe(3)
    expect(toNorm('cutoff', Math.sqrt(40 * 20000))).toBeCloseTo(0.5) // log knob: the middle is the geometric mean
  })
  it('old or corrupt stored values fall back to defaults', () => {
    expect(resolve('piano', { cutoff: NaN, reverbMix: 9 } as any)).toMatchObject({ cutoff: 20000, reverbMix: 1 })
    expect(resolve('piano', undefined)).toEqual(defaults('piano'))
  })
})

describe('presets', () => {
  it('load switches instrument; save/load round-trips; rename and delete', () => {
    settings.set({ instrument: 'piano' })
    loadPreset(FACTORY_PRESETS.find((p) => p.name === 'Warm Rhodes')!)
    expect(settings.get().instrument).toBe('epiano')
    expect(sound.get().preset.epiano).toBe('Warm Rhodes')
    setParam('cutoff', 1234)
    saveUserPreset('Mine')
    const saved = currentParams()
    loadPreset(FACTORY_PRESETS.find((p) => p.name === 'Init' && p.instrument === 'epiano')!)
    expect(getParam('cutoff')).toBe(20000)
    loadPreset(allPresets().find((p) => p.user && p.name === 'Mine')!)
    expect(currentParams()).toEqual(saved)
    renameUserPreset('Mine', 'Mine 2')
    expect(userPresets.get().items.map((p) => p.name)).toEqual(['Mine 2'])
    expect(sound.get().preset.epiano).toBe('Mine 2')
    saveUserPreset('Mine 2') // same name overwrites
    expect(userPresets.get().items).toHaveLength(1)
    deleteUserPreset('Mine 2')
    expect(userPresets.get().items).toHaveLength(0)
  })
})

describe('arpeggiator', () => {
  it('orders notes by mode across octaves', () => {
    const held = [64, 60, 67] // pressed E, C, G
    expect(arpPattern(held, 'up', 1)).toEqual([60, 64, 67])
    expect(arpPattern(held, 'down', 1)).toEqual([67, 64, 60])
    expect(arpPattern(held, 'updown', 1)).toEqual([60, 64, 67, 64])
    expect(arpPattern(held, 'played', 1)).toEqual([64, 60, 67])
    expect(arpPattern(held, 'up', 2)).toEqual([60, 64, 67, 72, 76, 79])
    expect(arpPattern(held, 'updown', 2)).toEqual([60, 64, 67, 72, 76, 79, 76, 72, 67, 64])
    expect(arpPattern([60, 60], 'up', 9)).toEqual([60, 72, 84]) // duplicates dropped, octaves capped at 3
    expect(arpPattern([120], 'up', 3)).toEqual([120]) // never above MIDI 127
    expect(arpPattern([60, 62], 'updown', 1)).toEqual([60, 62])
  })
  it('random never repeats a note when there is a choice', () => {
    let prev = -1
    for (let k = 0; k < 50; k++) { const i = randomStep(3, prev); expect(i).not.toBe(prev); expect(i).toBeLessThan(3); prev = i }
    expect(randomStep(1, 0)).toBe(0)
  })
})

describe('chord memory', () => {
  it('stores intervals and replays them from one key', () => {
    expect(chordShape([67, 60, 64, 60])).toEqual([0, 4, 7])
    expect(transposeShape([0, 3, 7], 62)).toEqual([62, 65, 69])
    expect(transposeShape([0, 4, 7], 125)).toEqual([125]) // out-of-range notes dropped
    expect(transposeShape([], 60)).toEqual([60])
  })
})

describe('MIDI learn', () => {
  it('learn maps the next CC, then the knob drives the parameter (absolute)', () => {
    settings.set({ instrument: 'synth' })
    learn.arm('cutoff')
    handleCC(30, 0)
    expect(learn.get().armed).toBeNull()
    expect(ccFor('cutoff')).toBe(30)
    setCCMode('cutoff', 'abs')
    handleCC(30, 127)
    expect(getParam('cutoff')).toBe(20000)
    handleCC(30, 0)
    expect(getParam('cutoff')).toBe(40)
    handleCC(31, 100) // unmapped: nothing
    expect(getParam('cutoff')).toBe(40)
    clearCC('cutoff')
    expect(ccFor('cutoff')).toBeNull()
  })
  it('auto mode follows a relative encoder and steps stepped params by one', () => {
    settings.set({ instrument: 'synth' })
    mapCC(40, 'reverbMix'); setParam('reverbMix', 0.5)
    handleCC(40, 65); handleCC(40, 65) // the repeat reveals a relative encoder
    handleCC(40, 65)
    expect(getParam('reverbMix')).toBeGreaterThan(0.5)
    expect(getParam('reverbMix')).toBeLessThan(0.6)
    mapCC(41, 'delayDiv', 'rel'); setParam('delayDiv', 2)
    handleCC(41, 65)
    expect(getParam('delayDiv')).toBe(3)
  })
  it('a target has one knob; the wizard maps knobs 1–8 in order and ignores the previous knob', () => {
    mapCC(50, 'chorus'); mapCC(51, 'chorus')
    expect(Object.values(ccMap.get().map).filter((m) => m.target === 'chorus')).toHaveLength(1)
    learn.wizard()
    handleCC(70, 10); handleCC(70, 11) // still turning knob 1
    for (let k = 1; k < 8; k++) handleCC(70 + k, 10)
    expect(WIZARD.map(ccFor)).toEqual([70, 71, 72, 73, 74, 75, 76, 77])
    expect(learn.get().armed).toBeNull()
  })
  it('mappings persist across a reload', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
    vi.resetModules()
    const c1 = await import('../src/audio/controls')
    c1.mapCC(22, 'brightness', 'rel')
    vi.resetModules()
    const s2 = await import('../src/store/store')
    expect(s2.ccMap.get().map[22]).toEqual({ target: 'brightness', mode: 'rel' })
    expect(s2.settings.get().volume).toBe(0.8) // other stores still load their defaults
  })
})
