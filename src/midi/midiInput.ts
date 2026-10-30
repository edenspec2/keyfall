// Web MIDI input: device discovery, hot-plug, message parsing, sustain pedal, pads, touch strips, diagnostic log.

export type InputEvent =
  | { type: 'on'; pitch: number; vel: number; channel: number; time: number; source: string }
  | { type: 'off'; pitch: number; channel: number; time: number; source: string }
  | { type: 'sustain'; down: boolean; channel: number; time: number; source: string }
  | { type: 'pad'; pad: number; vel: number; channel: number; time: number; source: string } // drum pad 0–7
  | { type: 'bend'; value: number; channel: number; time: number; source: string } // pitch strip, −1..1
  | { type: 'mod'; value: number; channel: number; time: number; source: string } // mod strip (CC 1), 0..1

/**
 * Knobs and faders: every Control Change except mod (1) and sustain (64). Kept out of `InputEvent` on purpose:
 * it goes to `midi.onCC` listeners only, so the scorer, recorder and screens never see knob traffic.
 */
export type CCEvent = { type: 'cc'; cc: number; value: number; raw: number; channel: number; time: number; source: string } // value 0..1
export type MidiEvent = InputEvent | CCEvent

export interface LogEntry { t: number; port: string; bytes: number[]; text: string }

export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready'

export interface MidiFilter {
  port: string // input id, 'auto' (best MiniLab/keyboard port) or 'all'
  channel: number // 1..16, or 0 = omni (keys only; pads are recognised by channel 10)
  pads: 'drums' | 'ignore' | 'notes' // MiniLab pads send notes on channel 10 by default
  padBase: number // note number of pad 1 (36 on the MiniLab 3 unless changed)
  padTouch?: PadTouch // how hard a pad hit lands; unset = as sent
}
export type PadTouch = 'light' | 'normal' | 'full'

/**
 * Pad velocity after the touch setting. MiniLab pads send low velocities unless struck hard; 'light' lifts soft taps
 * (20 → 50, 40 → 71) and keeps full hits full; 'full' plays every hit at full strength.
 */
export const padVel = (vel: number, touch: PadTouch = 'normal') =>
  touch === 'full' ? 127 : touch === 'light' ? Math.max(1, Math.round(127 * Math.sqrt(vel / 127))) : vel

/** Pad number 0–7 for a pad note; the second bank (base + 8 …) maps onto the same 8 drums. */
export const padIndex = (pitch: number, base: number) => (((pitch - base) % 8) + 8) % 8

/** Parse one raw MIDI message. Pure, so it can be unit-tested without hardware. */
export function parseMessage(data: ArrayLike<number>, time: number, source: string): MidiEvent | null {
  const status = data[0] & 0xf0
  const channel = (data[0] & 0x0f) + 1
  if (status === 0x90 && data[2] > 0) return { type: 'on', pitch: data[1], vel: data[2], channel, time, source }
  // Note On with velocity 0 is a Note Off (running-status keyboards use it).
  if (status === 0x80 || status === 0x90) return { type: 'off', pitch: data[1], channel, time, source }
  if (status === 0xb0 && data[1] === 64) return { type: 'sustain', down: data[2] >= 64, channel, time, source }
  if (status === 0xb0 && data[1] === 1) return { type: 'mod', value: data[2] / 127, channel, time, source }
  if (status === 0xb0 && data[1] < 120) return { type: 'cc', cc: data[1], value: data[2] / 127, raw: data[2], channel, time, source } // 120+ are channel mode messages
  if (status === 0xe0) return { type: 'bend', value: Math.max(-1, (((data[2] << 7) | data[1]) - 8192) / 8191), channel, time, source }
  return null
}

export function describeMessage(data: ArrayLike<number>): string {
  const s = data[0] & 0xf0, ch = (data[0] & 0x0f) + 1
  if (s === 0x90) return data[2] ? `Note On  ch${ch} note ${data[1]} vel ${data[2]}` : `Note Off ch${ch} note ${data[1]} (vel 0)`
  if (s === 0x80) return `Note Off ch${ch} note ${data[1]}`
  if (s === 0xb0) return `CC ${data[1]} = ${data[2]} ch${ch}${data[1] === 64 ? ' (sustain)' : ''}`
  if (s === 0xe0) return `Pitch bend ch${ch} ${((data[2] << 7) | data[1]) - 8192}`
  if (s === 0xd0) return `Aftertouch ch${ch} ${data[1]}`
  if (s === 0xc0) return `Program change ch${ch} ${data[1]}`
  if (data[0] === 0xf0) return `SysEx (${data.length} bytes)`
  return `0x${data[0].toString(16)}`
}

export const passesFilter = (e: InputEvent, f: MidiFilter, portId: string) =>
  (f.port === 'all' || f.port === portId) &&
  (e.type === 'pad' || f.channel === 0 || f.channel === e.channel)

/** Pad notes (channel 10) become drum hits, are dropped, or stay piano notes, depending on the setting. */
export function routePads(e: InputEvent | null, f: MidiFilter): InputEvent | null {
  if (!e || (e.type !== 'on' && e.type !== 'off') || e.channel !== 10 || f.pads === 'notes') return e
  if (f.pads === 'ignore' || e.type === 'off') return null // a drum hit has no length
  return { type: 'pad', pad: padIndex(e.pitch, f.padBase), vel: padVel(e.vel, f.padTouch), channel: 10, time: e.time, source: e.source }
}

export class MidiInput {
  status: MidiStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported'
  error = ''
  inputs: { id: string; name: string; state: string }[] = []
  log: LogEntry[] = []
  filter: MidiFilter = { port: 'auto', channel: 0, pads: 'drums', padBase: 36 }
  /** Set by Settings → "Detect pad 1": the next channel-10 note becomes pad 1. */
  onPadLearn: ((note: number) => void) | null = null
  bend = 0
  mod = 0
  /** Ports the browser listed but could not open (usually held by another program on Windows). */
  busy = new Set<string>()
  /** Pitches currently held down (physical keys), with the time they went down. */
  held = new Map<number, number>()
  sustain = false
  lastActivity = 0

  private access: MIDIAccess | null = null
  private listeners = new Set<(e: InputEvent) => void>()
  private ccListeners = new Set<(e: CCEvent) => void>()
  private changeListeners = new Set<() => void>()

  on(fn: (e: InputEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  onCC(fn: (e: CCEvent) => void) { this.ccListeners.add(fn); return () => { this.ccListeners.delete(fn) } }
  onChange(fn: () => void) { this.changeListeners.add(fn); return () => { this.changeListeners.delete(fn) } }
  private changed() { this.changeListeners.forEach((f) => f()) }

  async connect() {
    if (this.status === 'unsupported') return
    this.status = 'requesting'
    this.changed()
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.status = 'ready'
      this.access.onstatechange = () => this.refresh()
      this.refresh()
    } catch (err) {
      this.status = 'denied'
      this.error = err instanceof Error ? err.message : String(err)
      this.changed()
    }
  }

  /** Re-scan ports. Called on hot-plug; re-attaching handlers is idempotent. */
  refresh() {
    if (!this.access) return
    this.inputs = []
    this.access.inputs.forEach((input) => {
      this.inputs.push({ id: input.id, name: input.name ?? input.id, state: input.state })
      input.onmidimessage = (msg) => this.handle(input, msg)
      if (input.state === 'connected' && input.connection !== 'open') {
        input.open().then(() => { this.busy.delete(input.id); this.changed() }, () => { this.busy.add(input.id); this.changed() })
      }
    })
    // A port that vanished cannot send Note Off: release everything so nothing sticks.
    if (this.inputs.every((i) => i.state !== 'connected') && this.held.size) this.releaseAll()
    this.changed()
  }

  /**
   * Port used for 'auto': the MiniLab's main port. Its other ports (MCU/HUI, ALV, DIN thru, shown on Windows
   * as "MIDIIN2 (Minilab3 MIDI)" etc.) send button notes, so they are skipped. Other keyboards: first port.
   */
  suggestPort(): string {
    const ok = this.inputs.filter((i) => i.state === 'connected' && !/mcu|hui|alv|din|midiin[2-9]|loopmidi|through/i.test(i.name))
    return (ok.find((i) => /minilab/i.test(i.name)) ?? ok[0])?.id ?? 'all'
  }
  get activePort() { return this.filter.port === 'auto' ? this.suggestPort() : this.filter.port }

  private handle(input: MIDIInput, msg: MIDIMessageEvent) {
    const data = msg.data
    if (!data || data.length === 0 || data[0] === 0xf8 || data[0] === 0xfe) return // clock / active sensing
    const name = input.name ?? input.id
    this.log.push({ t: msg.timeStamp, port: name, bytes: Array.from(data), text: describeMessage(data) })
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200)
    this.lastActivity = performance.now()
    const raw = parseMessage(data, msg.timeStamp, input.id)
    // Knobs follow the port choice but not the channel filter (they may sit on another channel than the keys).
    if (raw?.type === 'cc') { if (this.filter.port === 'all' || this.activePort === input.id) this.ccListeners.forEach((f) => f(raw)); this.changed(); return }
    if (raw?.type === 'on' && raw.channel === 10 && this.onPadLearn) { this.onPadLearn(raw.pitch); this.onPadLearn = null }
    const e = routePads(raw, this.filter)
    if (e && passesFilter(e, { ...this.filter, port: this.activePort }, input.id)) this.emit(e)
    else this.changed()
  }

  /** Entry point for real and simulated input (on-screen keyboard, computer keyboard, tests). */
  emit(e: InputEvent) {
    if (e.type === 'on' && this.held.has(e.pitch)) return // same key echoed by a second port
    if (e.type === 'on') this.held.set(e.pitch, e.time)
    else if (e.type === 'off') this.held.delete(e.pitch)
    else if (e.type === 'sustain') this.sustain = e.down
    else if (e.type === 'bend') this.bend = e.value
    else if (e.type === 'mod') this.mod = e.value
    this.listeners.forEach((f) => f(e))
  }

  releaseAll() {
    const t = performance.now()
    for (const p of [...this.held.keys()]) this.emit({ type: 'off', pitch: p, channel: 1, time: t, source: 'system' })
    if (this.sustain) this.emit({ type: 'sustain', down: false, channel: 1, time: t, source: 'system' })
  }

  get connectedCount() { return this.inputs.filter((i) => i.state === 'connected').length }
}

export const midi = new MidiInput()
