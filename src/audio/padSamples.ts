// Pad samples: a sound recorded from the microphone (or loaded from a file) plays on a drum pad instead of its drum.
// The whole flow works from the MIDI keyboard: press the taught Sample button, make the sound, hit a pad.
import { audio } from './audioEngine'
import type { Binding } from '../midi/binding'
import { sameControl } from '../midi/binding'
import { persisted } from '../store/store'

export const MAX_SEC = 4 // a recording stops here
const FILE_MAX_SEC = 10
const START = 0.05 // peak that starts a take (-26 dB): a clap or a word, not room noise
const QUIET = 0.02 // the take ends after QUIET_SEC under this (-34 dB)
const QUIET_SEC = 0.7
const TAIL = 0.005 // a sound's ring is kept down to -46 dB
const PREROLL_SEC = 0.1 // kept from before the trigger, so the attack isn't cut
const WAIT_SEC = 10 // nothing heard for this long: give up
const PICK_SEC = 20 // a finished take waits this long for a pad

export interface PadSample { name: string; rate: number; data: Float32Array<ArrayBuffer> }

/** Mic chunks to one take: waits for a sound, keeps a little from before it, ends when it goes quiet. */
export class Take {
  started = false
  private rate: number
  private chunks: Float32Array<ArrayBuffer>[] = []
  private pre: Float32Array<ArrayBuffer>[] = []
  // in samples, not seconds: summing 0.1 s steps falls just short of a limit
  private waited = 0
  private heard = 0
  private quiet = 0
  constructor(rate: number) { this.rate = rate }

  push(c: Float32Array<ArrayBuffer>): 'waiting' | 'recording' | 'done' {
    const n = c.length, r = this.rate
    let peak = 0
    for (const v of c) peak = Math.max(peak, Math.abs(v))
    if (!this.started) {
      this.waited += n
      if (peak < START) {
        this.pre.push(c)
        if (this.pre.length > Math.ceil((PREROLL_SEC * r) / n)) this.pre.shift()
        return this.waited >= WAIT_SEC * r ? 'done' : 'waiting'
      }
      this.started = true
      this.chunks = this.pre
    }
    this.chunks.push(c)
    this.heard += n
    this.quiet = peak < QUIET ? this.quiet + n : 0
    return this.quiet >= QUIET_SEC * r || this.heard >= MAX_SEC * r ? 'done' : 'recording'
  }

  result() {
    if (!this.started) return null
    const all = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of this.chunks) { all.set(c, at); at += c.length }
    return finish(all, this.rate, MAX_SEC + PREROLL_SEC)
  }
}

/** Trim the silence at both ends, cap the length, bring the peak to -1 dB and fade the edges (no clicks). */
export function finish(data: Float32Array, rate: number, maxSec: number): Float32Array<ArrayBuffer> | null {
  let a = data.findIndex((v) => Math.abs(v) >= QUIET)
  if (a < 0) return null
  a = Math.max(0, a - Math.round(0.005 * rate))
  let b = data.length
  while (b > a && Math.abs(data[b - 1]) < TAIL) b--
  const out = data.slice(a, Math.min(b, a + Math.round(maxSec * rate)))
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const fadeIn = Math.min(out.length, Math.round(0.002 * rate)), fadeOut = Math.min(out.length, Math.round(0.01 * rate))
  for (let i = 0; i < out.length; i++) {
    const edge = Math.min(1, i / fadeIn, (out.length - 1 - i) / fadeOut)
    out[i] *= (0.9 / peak) * edge
  }
  return out
}

// Saved on the device (IndexedDB: a few hundred KB per pad is too much for localStorage), keyed by pad 0–7.
const STORE = 'pads'
function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((ok, fail) => {
    const open = indexedDB.open('mochimidi-samples', 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => fail(open.error)
    open.onsuccess = () => {
      const req = run(open.result.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => { ok(req.result); open.result.close() }
      req.onerror = () => { fail(req.error); open.result.close() }
    }
  })
}

export type Phase = 'idle' | 'listening' | 'recording' | 'pick'
interface State { phase: Phase; names: (string | null)[]; teaching: boolean; error: string }
let state: State = { phase: 'idle', names: Array(8).fill(null), teaching: false, error: '' }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }
/** For the screen: what the sampler is doing and which pads hold a sound. */
export const padSampler = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
/** The keyboard button taught to start a recording. */
export const sampleKey = persisted('sampler', { key: null as Binding | null })

let pending: PadSample | null = null
let target: number | null = null // a pad hit while recording ends the take and puts it there
let stopTake: (() => void) | null = null
let pickTimer = 0

function assign(k: number, s: PadSample | null) {
  audio.setPadSample(k, s)
  set({ names: state.names.map((n, i) => (i === k ? s?.name ?? null : n)) })
  void idb('readwrite', (st) => (s ? st.put(s, k) : st.delete(k))).catch(() => set({ error: 'Could not save the sound on this device; it lasts until you reload.' }))
}

/** Load the saved pad sounds into the engine (at startup). */
export async function initPadSamples() {
  if (typeof indexedDB === 'undefined') return
  for (let k = 0; k < 8; k++) {
    const s = await idb<PadSample | undefined>('readonly', (st) => st.get(k)).catch(() => undefined)
    if (s) assign(k, s)
  }
}

async function record(): Promise<{ rate: number; data: Float32Array<ArrayBuffer> | null }> {
  // Its own short-lived browser context: Tone's wrapped one has no script processor. Closed when the take ends.
  const ctx = new AudioContext()
  await ctx.resume()
  // Effects for calls (echo cancelling, noise suppression, auto level) smear music: record the sound as it is.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(2048, 1, 1)
  const take = new Take(ctx.sampleRate)
  return new Promise((done) => {
    stopTake = () => {
      proc.onaudioprocess = null
      stream.getTracks().forEach((t) => t.stop()) // let go of the mic at once
      void ctx.close()
      stopTake = null
      done({ rate: ctx.sampleRate, data: take.result() })
    }
    proc.onaudioprocess = (e) => {
      const s = take.push(new Float32Array(e.inputBuffer.getChannelData(0))) // a copy: the browser reuses the buffer
      if (s === 'recording' && state.phase === 'listening') set({ phase: 'recording' })
      if (s === 'done') stopTake?.()
    }
    src.connect(proc)
    proc.connect(ctx.destination) // a script processor runs only while connected to the output (it outputs silence)
  })
}

/** The Sample button: start listening; pressed again, stop (keeping what was recorded) or drop a take nobody placed. */
export async function pressSample() {
  if (state.phase === 'listening' || state.phase === 'recording') { stopTake?.(); return }
  if (state.phase === 'pick') { pending = null; set({ phase: 'idle' }); return }
  await audio.start()
  if (audio.ctx.state !== 'running') { set({ error: 'Tap the screen once to turn on sound, then press Sample again.' }); return }
  target = null
  set({ phase: 'listening', error: '' })
  let rec: Awaited<ReturnType<typeof record>>
  try { rec = await record() } catch (e) {
    const denied = e instanceof DOMException && e.name === 'NotAllowedError'
    set({ phase: 'idle', error: denied ? 'The microphone is blocked. Allow it for this site in the browser, then try again.' : `No microphone: ${String(e)}` })
    return
  }
  if (!rec.data) { set({ phase: 'idle' }); return }
  const take: PadSample = { name: 'My sound', rate: rec.rate, data: rec.data }
  if (target !== null) { assign(target, take); audio.drum(target); set({ phase: 'idle' }); return }
  pending = take
  set({ phase: 'pick' })
  clearTimeout(pickTimer)
  pickTimer = window.setTimeout(() => { if (state.phase === 'pick') { pending = null; set({ phase: 'idle' }) } }, PICK_SEC * 1000)
}

/** A pad was hit. Returns true when the hit belongs to the sampler and must not play. */
export function padHit(k: number): boolean {
  if (state.phase === 'listening') { stopTake?.(); assign(k, null); return false } // Sample, then a pad, no sound: its drum is back
  if (state.phase === 'recording') { target = k; stopTake?.(); return true }
  if (state.phase === 'pick' && pending) { assign(k, pending); pending = null; set({ phase: 'idle' }); return false } // plays the new sound
  return false
}

/** A keyboard key, pad or button was pressed. True when it is the Sample button (or is being taught as it): no sound. */
export function sampleControl(b: Binding): boolean {
  if (state.teaching) { sampleKey.set({ key: b }); set({ teaching: false }); return true }
  const key = sampleKey.get().key
  if (key && sameControl(key, b)) { void pressSample(); return true }
  return false
}
export const teachSampleKey = (on: boolean) => set({ teaching: on })

/** Load an audio file onto pad `k` (mixed to mono, silence trimmed, at most 10 s). */
export async function loadPadFile(k: number, file: File) {
  const b = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer())
  const mono = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) b.getChannelData(c).forEach((v, i) => { mono[i] += v / b.numberOfChannels })
  const data = finish(mono, b.sampleRate, FILE_MAX_SEC)
  if (!data) throw new Error('the file is silent')
  assign(k, { name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), rate: b.sampleRate, data })
}
export const clearPad = (k: number) => assign(k, null)
