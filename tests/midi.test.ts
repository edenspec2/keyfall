import { describe, expect, it, vi } from 'vitest'
import { MidiInput, parseMessage, routePads, type InputEvent, type MidiFilter } from '../src/midi/midiInput'

describe('parseMessage', () => {
  it('reads Note On / Note Off with channel and velocity', () => {
    expect(parseMessage([0x90, 60, 100], 1, 'p')).toMatchObject({ type: 'on', pitch: 60, vel: 100, channel: 1 })
    expect(parseMessage([0x83, 61, 0], 1, 'p')).toMatchObject({ type: 'off', pitch: 61, channel: 4 })
  })
  it('treats Note On with velocity 0 as Note Off', () => {
    expect(parseMessage([0x90, 60, 0], 1, 'p')).toMatchObject({ type: 'off', pitch: 60 })
  })
  it('reads the sustain pedal (CC64) and ignores other messages', () => {
    expect(parseMessage([0xb0, 64, 127], 1, 'p')).toMatchObject({ type: 'sustain', down: true })
    expect(parseMessage([0xb0, 64, 0], 1, 'p')).toMatchObject({ type: 'sustain', down: false })
    expect(parseMessage([0xb0, 7, 50], 1, 'p')).toMatchObject({ type: 'cc', cc: 7, raw: 50 }) // knobs and faders are CC events now
    expect(parseMessage([0xd0, 40], 1, 'p')).toBeNull()
  })
  it('reads the pitch strip (bend) and the mod strip (CC 1)', () => {
    expect(parseMessage([0xe0, 0, 64], 1, 'p')).toMatchObject({ type: 'bend', value: 0 })
    expect(parseMessage([0xe0, 127, 127], 1, 'p')).toMatchObject({ type: 'bend', value: 1 })
    expect(parseMessage([0xe0, 0, 0], 1, 'p')).toMatchObject({ type: 'bend', value: -1 })
    expect(parseMessage([0xb0, 1, 127], 1, 'p')).toMatchObject({ type: 'mod', value: 1 })
  })
})

/** Minimal fake of the Web MIDI API: ports can be added/removed and fire statechange. */
function fakeAccess() {
  const inputs = new Map<string, any>()
  const access: any = { inputs, onstatechange: null }
  const add = (id: string, name: string) => {
    const port: any = { id, name, state: 'connected', connection: 'closed', onmidimessage: null, open: () => Promise.resolve() }
    inputs.set(id, port); access.onstatechange?.()
    return port
  }
  const send = (id: string, bytes: number[]) => inputs.get(id).onmidimessage({ data: new Uint8Array(bytes), timeStamp: 5 })
  return { access, add, send, unplug: (id: string) => { inputs.get(id).state = 'disconnected'; access.onstatechange?.() } }
}

async function connected() {
  const f = fakeAccess()
  vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve(f.access) })
  const m = new MidiInput()
  await m.connect()
  const events: InputEvent[] = []
  m.on((e) => events.push(e))
  return { f, m, events }
}

describe('MidiInput', () => {
  it('picks the MiniLab main port and ignores its DAW/MCU port and the pads channel', async () => {
    const { f, m, events } = await connected()
    f.add('a', 'MIDIIN2 (Minilab3 MIDI)')
    f.add('b', 'Minilab3 MIDI')
    expect(m.activePort).toBe('b')
    f.send('a', [0x90, 94, 127]) // MCU transport button
    f.send('b', [0x99, 36, 100]) // pad 1 on channel 10 → kick drum, not a piano note
    f.send('b', [0x89, 36, 0]) // pad release: drums have no length
    f.send('b', [0x90, 60, 80])
    expect(events.map((e) => (e.type === 'on' ? e.pitch : e.type === 'pad' ? `pad${e.pad}` : e.type))).toEqual(['pad0', 60])
    expect(m.held.has(36)).toBe(false)
    expect(m.log).toHaveLength(4) // diagnostics still sees everything
  })

  it('handles several keys at once and releases held notes on disconnect', async () => {
    const { f, m, events } = await connected()
    f.add('b', 'Minilab3 MIDI')
    f.send('b', [0x90, 60, 80]); f.send('b', [0x90, 64, 80]); f.send('b', [0x90, 67, 80])
    expect([...m.held.keys()]).toEqual([60, 64, 67])
    f.unplug('b')
    expect(m.held.size).toBe(0)
    expect(events.filter((e) => e.type === 'off')).toHaveLength(3)
  })

  it('keeps working after the device is plugged back in', async () => {
    const { f, m, events } = await connected()
    f.add('b', 'Minilab3 MIDI'); f.unplug('b')
    f.access.inputs.delete('b')
    f.add('b2', 'Minilab3 MIDI') // Windows may give the port a new id
    f.send('b2', [0x90, 62, 90])
    expect(m.activePort).toBe('b2')
    expect(events.at(-1)).toMatchObject({ type: 'on', pitch: 62 })
  })

  it('maps octave-shifted keys to their real pitch (no hidden transposition)', async () => {
    const { f, events } = await connected()
    f.add('b', 'Minilab3 MIDI')
    f.send('b', [0x90, 48 + 12, 80]) // lowest key after Oct+ sends C4
    expect(events[0]).toMatchObject({ pitch: 60 })
  })

  it('drops a duplicate Note On for a key that is already down', async () => {
    const { m, events } = await connected()
    m.emit({ type: 'on', pitch: 60, vel: 80, channel: 1, time: 0, source: 'x' })
    m.emit({ type: 'on', pitch: 60, vel: 80, channel: 1, time: 0, source: 'y' })
    expect(events).toHaveLength(1)
  })
})

describe('pads', () => {
  const f = (o: Partial<MidiFilter> = {}): MidiFilter => ({ port: 'all', channel: 0, pads: 'drums', padBase: 36, ...o })
  const pad = (note: number) => parseMessage([0x99, note, 90], 0, 'p')
  it('maps pad notes to the 8 drums, both banks onto the same kit', () => {
    expect(routePads(pad(36), f())).toMatchObject({ type: 'pad', pad: 0, vel: 90 })
    expect(routePads(pad(43), f())).toMatchObject({ pad: 7 })
    expect(routePads(pad(44), f())).toMatchObject({ pad: 0 }) // bank B
  })
  it('respects a detected pad-1 note, "ignore" and "piano notes"', () => {
    expect(routePads(pad(48), f({ padBase: 48 }))).toMatchObject({ pad: 0 })
    expect(routePads(pad(36), f({ pads: 'ignore' }))).toBeNull()
    expect(routePads(pad(36), f({ pads: 'notes' }))).toMatchObject({ type: 'on', pitch: 36 })
  })
  it('leaves keys alone', () => {
    expect(routePads(parseMessage([0x90, 36, 90], 0, 'p'), f())).toMatchObject({ type: 'on', pitch: 36 })
  })
})
