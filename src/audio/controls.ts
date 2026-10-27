// Glue between the stores and the sound (no Tone, so it is testable): parameter get/set, presets,
// chord capture, and MIDI learn with absolute/relative CC decoding.
import { ccMap, settings, sound, userPresets } from '../store/store'
import { chordShape } from './arp'
import type { InstrumentId } from './audioEngine'
import { clampParam, defaults, deletePreset, FACTORY_PRESETS, fromNorm, renamePreset, resolve, snapshot, spec, toNorm, upsertPreset, type Params, type Preset, type Target } from './sound'

const inst = () => settings.get().instrument

// ---- parameters ----
export function getParam(id: Target, i: InstrumentId = inst()): number {
  if (id === 'master') return settings.get().volume
  const v = sound.get().params[i]?.[id]
  return typeof v === 'number' ? clampParam(id, v) : defaults(i)[id]
}
export function setParam(id: Target, v: number) {
  if (id === 'master') { settings.set({ volume: clampParam(id, v) }); return }
  const i = inst()
  sound.set((s) => ({ ...s, params: { ...s.params, [i]: { ...s.params[i], [id]: clampParam(id, v) } } }))
}
export const currentParams = (i: InstrumentId = inst()): Params => resolve(i, sound.get().params[i])
/** All instruments' resolved params, for the engine. */
export const allSounds = () => Object.fromEntries((['piano', 'epiano', 'strings', 'synth'] as InstrumentId[]).map((i) => [i, currentParams(i)])) as Record<InstrumentId, Params>

// ---- presets ----
export const allPresets = (): (Preset & { user?: boolean })[] => [...FACTORY_PRESETS, ...userPresets.get().items.map((p) => ({ ...p, user: true }))]
export function loadPreset(p: Preset) {
  if (p.instrument !== inst()) settings.set({ instrument: p.instrument }) // a preset brings its instrument
  sound.set((s) => ({ ...s, params: { ...s.params, [p.instrument]: { ...p.params } }, preset: { ...s.preset, [p.instrument]: p.name } }))
}
export function saveUserPreset(name: string) {
  const i = inst()
  userPresets.set((u) => ({ items: upsertPreset(u.items, { name, instrument: i, params: snapshot(i, currentParams(i)) }) }))
  sound.set((s) => ({ ...s, preset: { ...s.preset, [i]: name } }))
}
export function renameUserPreset(from: string, to: string) {
  const i = inst()
  userPresets.set((u) => ({ items: renamePreset(u.items, i, from, to) }))
  if (sound.get().preset[i] === from) sound.set((s) => ({ ...s, preset: { ...s.preset, [i]: to } }))
}
export function deleteUserPreset(name: string) {
  const i = inst()
  userPresets.set((u) => ({ items: deletePreset(u.items, i, name) }))
}
/** Remember the shape of the held keys for chord memory (needs 2+ notes). */
export function captureChord(held: number[]) {
  if (new Set(held).size < 2) return false
  sound.set((s) => ({ ...s, chord: { ...s.chord, shape: chordShape(held), on: true } }))
  return true
}

// ---- CC decoding ----
export type CCMode = 'auto' | 'abs' | 'rel'
export type Encoding = 'abs' | 'rel64' | 'twos' | null
const in64 = (v: number) => v >= 57 && v <= 71
const inTwos = (v: number) => (v >= 1 && v <= 7) || v >= 121

/**
 * Guess how a knob encodes its value from its recent raw values (newest last).
 * Endless encoders in relative mode send small offsets around 64 (binary offset) or 1–7 / 121–127
 * (two's complement), and repeat the same value while turning slowly; absolute knobs only send on change,
 * so a repeated value means relative. null = not sure yet (ignore the message rather than jump).
 */
export function detectEncoding(h: number[]): Encoding {
  if (!h.length) return null
  const b64 = h.every(in64), b2 = h.every(inTwos)
  if (!b64 && !b2) return 'abs'
  if (h.some((v, i) => i > 0 && v === h[i - 1])) return b64 ? 'rel64' : 'twos'
  return h.length >= 4 ? 'abs' : null
}
/** Signed step count from one relative message. */
export const relDelta = (v: number, enc: 'rel64' | 'twos') => (enc === 'rel64' ? v - 64 : v < 64 ? v : v - 128)
export const REL_STEP = 1 / 64 // knob travel per encoder detent: ~3 turns end to end

/** New knob position 0..1 from one CC value, or null when the encoding is still unknown. */
export function decodeCC(prev01: number, raw: number, enc: Encoding): number | null {
  if (!enc) return null
  if (enc === 'abs') return raw / 127
  return Math.min(1, Math.max(0, prev01 + relDelta(raw, enc) * REL_STEP))
}

const history = new Map<number, number[]>() // cc → last raw values
const sticky = new Map<number, Encoding>() // once a CC proved relative it stays relative
export function encodingFor(cc: number, mode: CCMode): Encoding {
  const h = history.get(cc) ?? []
  const raw = h[h.length - 1] ?? 64
  if (mode === 'abs') return 'abs'
  if (mode === 'rel') return in64(raw) ? 'rel64' : 'twos'
  if (sticky.has(cc)) return sticky.get(cc)!
  const e = detectEncoding(h)
  if (e === 'rel64' || e === 'twos') sticky.set(cc, e)
  return e
}

// ---- MIDI learn ----
export interface LearnState { armed: Target | null; queue: Target[]; used: number[] }
/** The one-go MiniLab setup: knobs 1–8 → the 4 macros, then 4 effects. */
export const WIZARD: Target[] = ['brightness', 'timbre', 'time', 'movement', 'reverbMix', 'delayMix', 'chorus', 'drive']
/** What the MiniLab's 4 faders drive, after the 8 knobs. */
export const FADERS: Target[] = ['reverbDecay', 'cutoff', 'keysVol', 'master']
export const HARDWARE: Target[] = [...WIZARD, ...FADERS]
// MiniLab 3 factory CCs: knobs 1–8 then faders 1–4.
// shortcut: taken from Arturia's docs, not checked on a device; an unknown CC still auto-assigns below.
export const MINILAB_CCS = [74, 71, 76, 77, 93, 18, 19, 16, 82, 83, 85, 17]

/** Last hardware move, for the on-screen readout ("Reverb time 3.2 s"). */
let lastMove: { target: Target; at: number } | null = null
const moveSubs = new Set<() => void>()
export const moves = {
  get: () => lastMove,
  subscribe: (f: () => void) => { moveSubs.add(f); return () => { moveSubs.delete(f) } },
}
const moved = (target: Target) => { lastMove = { target, at: performance.now() }; moveSubs.forEach((f) => f()) }

/**
 * A knob nobody assigned yet: its MiniLab factory slot if that slot is free, otherwise the next free control
 * in hardware order. Knobs work out of the box; MIDI learn is only for changing them.
 */
export function autoTarget(cc: number, map: Record<number, { target: Target }>): Target | null {
  const used = new Set(Object.values(map).map((m) => m.target))
  const factory = HARDWARE[MINILAB_CCS.indexOf(cc)]
  if (factory && !used.has(factory)) return factory
  return HARDWARE.find((t) => !used.has(t)) ?? null
}

let learnState: LearnState = { armed: null, queue: [], used: [] }
const learnSubs = new Set<() => void>()
export const learn = {
  get: () => learnState,
  subscribe: (f: () => void) => { learnSubs.add(f); return () => { learnSubs.delete(f) } },
  set(s: LearnState) { learnState = s; learnSubs.forEach((f) => f()) },
  arm(t: Target | null) { learn.set({ armed: t, queue: [], used: [] }) },
  wizard() { learn.set({ armed: WIZARD[0], queue: WIZARD.slice(1), used: [] }) },
}

/**
 * Knobs picked up automatically live for this session only. Persisting them let any stray CC (the main encoder,
 * a button, bank select) take a control for good and push real knobs onto other controls. MIDI learn persists.
 */
const autoMap = new Map<number, { target: Target; mode: CCMode }>()
// Standard controllers that are never a knob: bank select, data entry, volume, pan, expression, (N)RPN, channel mode.
const NOT_KNOBS = new Set([0, 6, 7, 10, 11, 32, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127])
const dropAuto = (target: Target) => { for (const [c, v] of autoMap) if (v.target === target) autoMap.delete(c) }

export function mapCC(cc: number, target: Target, mode: CCMode = 'auto') {
  // One knob per target and one target per knob.
  dropAuto(target)
  autoMap.delete(cc)
  ccMap.set((m) => ({ map: { ...Object.fromEntries(Object.entries(m.map).filter(([, v]) => v.target !== target)), [cc]: { target, mode } } }))
}
export const clearCC = (target: Target) => ccMap.set((m) => ({ map: Object.fromEntries(Object.entries(m.map).filter(([, v]) => v.target !== target)) }))
export const ccFor = (target: Target) => {
  const e = Object.entries(ccMap.get().map).find(([, v]) => v.target === target) ?? [...autoMap].find(([, v]) => v.target === target)
  return e ? +e[0] : null
}
export function setCCMode(target: Target, mode: CCMode) {
  const cc = ccFor(target)
  if (cc !== null) { sticky.delete(cc); autoMap.delete(cc); ccMap.set((m) => ({ map: { ...m.map, [cc]: { target, mode } } })) }
}

/** Every Control Change except mod (1) and sustain (64) lands here. Keys and pads never reach it. */
export function handleCC(cc: number, raw: number) {
  const h = history.get(cc) ?? []
  h.push(raw)
  if (h.length > 8) h.shift()
  history.set(cc, h)
  const L = learnState
  if (L.armed) {
    if (L.used.includes(cc)) return // still turning the previous knob of the wizard
    mapCC(cc, L.armed)
    learn.set(L.queue.length ? { armed: L.queue[0], queue: L.queue.slice(1), used: [...L.used, cc] } : { armed: null, queue: [], used: [] })
    return
  }
  let m = ccMap.get().map[cc] ?? autoMap.get(cc)
  if (!m) {
    if (NOT_KNOBS.has(cc)) return
    // A MiniLab knob always gets its own slot back from a stray CC that grabbed it earlier this session.
    const factory = HARDWARE[MINILAB_CCS.indexOf(cc)]
    if (factory) dropAuto(factory)
    const t = autoTarget(cc, { ...Object.fromEntries(autoMap), ...ccMap.get().map })
    if (!t) return
    m = { target: t, mode: 'auto' }
    autoMap.set(cc, m)
    ccMap.set((x) => ({ ...x })) // let the panel show the new knob's CC
  }
  const t = m.target, cur = getParam(t), prev = toNorm(t, cur)
  const n = decodeCC(prev, raw, encodingFor(cc, m.mode))
  if (n === null) return
  let v = fromNorm(t, n)
  if (v === cur && n !== prev && spec(t).curve === 'int') v = clampParam(t, cur + Math.sign(n - prev)) // one detent moves a stepped param
  if (v !== cur) setParam(t, v)
  moved(t)
}
