// Sound model (pure, no Tone): parameter specs, per-instrument defaults, macro math, presets.
import type { InstrumentId } from './audioEngine'

export type Curve = 'lin' | 'log' | 'int'
export interface ParamSpec { label: string; min: number; max: number; def: number; curve?: Curve; unit?: string; fmt?: (v: number) => string }

export const DELAY_DIVS = [{ label: '1/16', beats: 0.25 }, { label: '1/8T', beats: 1 / 3 }, { label: '1/8', beats: 0.5 }, { label: '1/8D', beats: 0.75 }, { label: '1/4', beats: 1 }, { label: '1/4D', beats: 1.5 }, { label: '1/2', beats: 2 }]
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const

const pct = (v: number) => `${Math.round(v * 100)}%`
const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`

export const PARAMS = {
  // Analog Lab macros: 0.5 = the sound as designed, each moves several parameters (see `effective`).
  brightness: { label: 'Brightness', min: 0, max: 1, def: 0.5, fmt: pct },
  timbre: { label: 'Timbre', min: 0, max: 1, def: 0.5, fmt: pct },
  time: { label: 'Time', min: 0, max: 1, def: 0.5, fmt: pct },
  movement: { label: 'Movement', min: 0, max: 1, def: 0.5, fmt: pct },
  cutoff: { label: 'Cutoff', min: 40, max: 20000, def: 20000, curve: 'log', fmt: hz },
  resonance: { label: 'Resonance', min: 0.5, max: 12, def: 0.7, curve: 'log', fmt: (v: number) => v.toFixed(1) },
  filterType: { label: 'Type', min: 0, max: 2, def: 0, curve: 'int', fmt: (v: number) => ['LP', 'HP', 'BP'][v] },
  attack: { label: 'Attack', min: 0.001, max: 4, def: 0.005, curve: 'log', fmt: sec },
  decay: { label: 'Decay', min: 0.01, max: 6, def: 0.2, curve: 'log', fmt: sec },
  sustain: { label: 'Sustain', min: 0, max: 1, def: 0.4, fmt: pct },
  release: { label: 'Release', min: 0.01, max: 8, def: 0.3, curve: 'log', fmt: sec },
  drive: { label: 'Drive', min: 0, max: 1, def: 0, fmt: pct },
  chorus: { label: 'Chorus', min: 0, max: 1, def: 0, fmt: pct },
  phaser: { label: 'Phaser', min: 0, max: 1, def: 0, fmt: pct },
  tremolo: { label: 'Tremolo', min: 0, max: 1, def: 0, fmt: pct },
  lfoRate: { label: 'LFO rate', min: 0.1, max: 12, def: 4, curve: 'log', fmt: (v: number) => `${v.toFixed(1)} Hz` },
  delayDiv: { label: 'Delay time', min: 0, max: DELAY_DIVS.length - 1, def: 2, curve: 'int', fmt: (v: number) => DELAY_DIVS[v].label },
  delayFeedback: { label: 'Feedback', min: 0, max: 0.9, def: 0.3, fmt: pct },
  delayMix: { label: 'Delay mix', min: 0, max: 1, def: 0, fmt: pct },
  reverbDecay: { label: 'Reverb time', min: 0.3, max: 12, def: 2.2, curve: 'log', fmt: sec },
  reverbPreDelay: { label: 'Pre-delay', min: 0, max: 0.2, def: 0.01, fmt: sec },
  reverbMix: { label: 'Reverb mix', min: 0, max: 1, def: 0, fmt: pct },
  eqLow: { label: 'Low', min: -12, max: 12, def: 0, fmt: db },
  eqMid: { label: 'Mid', min: -12, max: 12, def: 0, fmt: db },
  eqHigh: { label: 'High', min: -12, max: 12, def: 0, fmt: db },
  width: { label: 'Width', min: 0, max: 1, def: 0.5, fmt: pct },
  glide: { label: 'Glide', min: 0, max: 0.5, def: 0, fmt: sec },
  vibratoRate: { label: 'Vibrato rate', min: 1, max: 10, def: 5.5, fmt: (v: number) => `${v.toFixed(1)} Hz` },
  keysVol: { label: 'Keys', min: -30, max: 6, def: 0, fmt: db },
  drumsVol: { label: 'Drums', min: -30, max: 6, def: 0, fmt: db },
} satisfies Record<string, ParamSpec>

export type ParamId = keyof typeof PARAMS
export type Params = Record<ParamId, number>
export const PARAM_IDS = Object.keys(PARAMS) as ParamId[]
export const MACROS: ParamId[] = ['brightness', 'timbre', 'time', 'movement']
/** What a learned CC can drive: any parameter, or the master volume (settings.volume). */
export type Target = ParamId | 'master'
export const spec = (id: Target): ParamSpec => (id === 'master' ? MASTER : PARAMS[id])
const MASTER: ParamSpec = { label: 'Master', min: 0, max: 1, def: 0.8, fmt: pct }

const BASE = Object.fromEntries(PARAM_IDS.map((k) => [k, PARAMS[k].def])) as Params
// "Init" per instrument = today's sound: the piano keeps its light reverb, synths keep their envelopes.
const INIT: Record<InstrumentId, Partial<Params>> = {
  piano: { attack: 0.001, release: 0.9, reverbMix: 0.16 },
  epiano: { attack: 0.002, decay: 1.2, sustain: 0.25, release: 0.8 },
  strings: { attack: 0.25, decay: 0.3, sustain: 0.8, release: 1.4 },
  synth: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
}
const DEFAULTS = Object.fromEntries(Object.entries(INIT).map(([k, v]) => [k, { ...BASE, ...v }])) as Record<InstrumentId, Params>
export const defaults = (inst: InstrumentId): Params => DEFAULTS[inst] ?? BASE

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Clamp and snap a value into its parameter's range (also cleans old/corrupt stored values). */
export function clampParam(id: Target, v: number) {
  const s = spec(id)
  if (!Number.isFinite(v)) return s.def
  const c = clamp(v, s.min, s.max)
  return s.curve === 'int' ? Math.round(c) : c
}
/** Knob position 0..1 ↔ value; log params turn evenly in octaves. */
export function toNorm(id: Target, v: number) {
  const s = spec(id), c = clampParam(id, v)
  return s.curve === 'log' ? Math.log(c / s.min) / Math.log(s.max / s.min) : (c - s.min) / (s.max - s.min)
}
export function fromNorm(id: Target, n: number) {
  const s = spec(id), t = clamp(n, 0, 1)
  return clampParam(id, s.curve === 'log' ? s.min * Math.pow(s.max / s.min, t) : s.min + t * (s.max - s.min))
}

/** Stored partial params on top of the instrument's Init sound. */
export function resolve(inst: InstrumentId, stored?: Partial<Params>): Params {
  const p = { ...defaults(inst) }
  if (stored) for (const k of PARAM_IDS) if (typeof stored[k] === 'number') p[k] = clampParam(k, stored[k])
  return p
}

/** The values the audio graph actually uses: detailed params bent by the 4 macros (0.5 = neutral). */
export interface Effective {
  cutoff: number; resonance: number; filterType: (typeof FILTER_TYPES)[number]
  attack: number; decay: number; sustain: number; release: number
  drive: number; chorus: number; phaser: number; tremolo: number; lfoRate: number
  delayBeats: number; delayFeedback: number; delayMix: number
  reverbDecay: number; reverbPreDelay: number; reverbMix: number
  eqLow: number; eqMid: number; eqHigh: number; width: number; glide: number; vibratoRate: number
  keysVol: number; drumsVol: number
  modIndex: number; harmonicity: number; spread: number // instrument timbre
}
export function effective(p: Params, inst: InstrumentId): Effective {
  const b = p.brightness - 0.5, t = p.timbre - 0.5, m = p.time - 0.5, v = p.movement - 0.5
  const time = Math.pow(2, m * 4) // Time: ×0.25 … ×4 on attack, release and reverb decay
  const up = Math.max(0, v), keys = inst === 'piano' || inst === 'epiano'
  return {
    // Brightness: ±4 octaves of cutoff and ±6 dB on the high shelf.
    cutoff: clamp(p.cutoff * Math.pow(2, b * 8), 40, 20000),
    resonance: p.resonance,
    filterType: FILTER_TYPES[p.filterType] ?? 'lowpass',
    attack: clamp(p.attack * time, 0.001, 8),
    decay: p.decay,
    sustain: p.sustain,
    release: clamp(p.release * time, 0.01, 16),
    // Timbre: piano and e-piano get drive above centre; piano also a mid "bark" tilt.
    drive: clamp(p.drive + (inst === 'piano' ? Math.max(0, t) * 1.2 : inst === 'epiano' ? Math.max(0, t) * 0.6 : 0), 0, 1),
    // Movement: chorus everywhere, tremolo on keys, phaser on strings/synth, faster LFO.
    chorus: clamp(p.chorus + up * 1.2, 0, 1),
    phaser: clamp(p.phaser + (keys ? 0 : up * 1.2), 0, 1),
    tremolo: clamp(p.tremolo + (keys ? up * 1.2 : 0), 0, 1),
    lfoRate: clamp(p.lfoRate * Math.pow(2, v * 3), 0.05, 20),
    delayBeats: DELAY_DIVS[p.delayDiv]?.beats ?? 0.5,
    delayFeedback: p.delayFeedback,
    delayMix: p.delayMix,
    reverbDecay: clamp(p.reverbDecay * time, 0.3, 15),
    reverbPreDelay: p.reverbPreDelay,
    reverbMix: p.reverbMix,
    eqLow: p.eqLow,
    eqMid: clamp(p.eqMid + (inst === 'piano' ? t * 8 : 0), -18, 18),
    eqHigh: clamp(p.eqHigh + b * 12, -24, 18),
    width: p.width,
    glide: p.glide,
    vibratoRate: p.vibratoRate,
    keysVol: p.keysVol,
    drumsVol: p.drumsVol,
    modIndex: 6 * Math.pow(2, t * 3), // e-piano FM index: 2.1 … 17
    harmonicity: Math.round(1 + p.timbre * 3), // strings AM: whole ratios 1–4 stay harmonic
    spread: p.timbre * 40, // synth lead: detune of the 3 stacked saws, in cents
  }
}

// ---- presets ----
export interface Preset { name: string; instrument: InstrumentId; params: Partial<Params> }
export const FACTORY_PRESETS: Preset[] = [
  { name: 'Init', instrument: 'piano', params: {} },
  { name: 'Concert Grand', instrument: 'piano', params: { reverbMix: 0.24, reverbDecay: 3.2, reverbPreDelay: 0.025, width: 0.68, eqHigh: 1.5, eqLow: 1 } },
  { name: 'Felt Piano', instrument: 'piano', params: { cutoff: 1900, eqLow: 2.5, eqHigh: -5, release: 0.6, reverbMix: 0.28, reverbDecay: 2.6, width: 0.6 } },
  { name: 'Lo-fi Keys', instrument: 'piano', params: { cutoff: 3600, drive: 0.35, chorus: 0.4, lfoRate: 0.8, eqLow: 3, eqHigh: -6, width: 0.4, delayMix: 0.14, delayDiv: 3, reverbMix: 0.2 } },
  { name: 'Init', instrument: 'epiano', params: {} },
  { name: 'Warm Rhodes', instrument: 'epiano', params: { timbre: 0.38, tremolo: 0.35, lfoRate: 4.5, chorus: 0.2, drive: 0.12, eqHigh: -2, reverbMix: 0.18, width: 0.65 } },
  { name: 'DX Tine', instrument: 'epiano', params: { timbre: 0.68, chorus: 0.45, lfoRate: 1.2, reverbMix: 0.22, delayMix: 0.12, eqHigh: 2 } },
  { name: 'Suitcase Trem', instrument: 'epiano', params: { timbre: 0.45, tremolo: 0.7, lfoRate: 5.5, width: 0.85, drive: 0.25, reverbMix: 0.15 } },
  { name: 'Init', instrument: 'strings', params: {} },
  { name: 'Wide Strings', instrument: 'strings', params: { width: 0.92, chorus: 0.45, lfoRate: 0.6, reverbMix: 0.35, reverbDecay: 4, attack: 0.4, release: 2.2 } },
  { name: 'Glass Pad', instrument: 'strings', params: { timbre: 0.95, attack: 0.8, release: 3.5, phaser: 0.3, lfoRate: 0.3, delayMix: 0.2, delayDiv: 5, delayFeedback: 0.45, reverbMix: 0.45, reverbDecay: 6, width: 0.8 } },
  { name: 'Slow Swell', instrument: 'strings', params: { attack: 1.6, release: 3, cutoff: 4500, reverbMix: 0.3, reverbDecay: 3.5, eqLow: 2 } },
  { name: 'Init', instrument: 'synth', params: {} },
  { name: 'Saw Lead', instrument: 'synth', params: { cutoff: 6000, resonance: 3, glide: 0.04, delayMix: 0.18, delayDiv: 3, reverbMix: 0.12 } },
  { name: 'Acid Line', instrument: 'synth', params: { timbre: 0.1, cutoff: 900, resonance: 9, drive: 0.4, decay: 0.25, sustain: 0.2, release: 0.12, delayMix: 0.15 } },
  { name: 'Space Lead', instrument: 'synth', params: { glide: 0.12, vibratoRate: 6, delayMix: 0.3, delayFeedback: 0.5, delayDiv: 5, reverbMix: 0.35, reverbDecay: 6, width: 0.85, release: 0.8 } },
]

/** Save or overwrite a user preset by name (per instrument). Returns a new list. */
export const upsertPreset = (list: Preset[], p: Preset) => [...list.filter((x) => !(x.name === p.name && x.instrument === p.instrument)), p]
export const renamePreset = (list: Preset[], inst: InstrumentId, from: string, to: string) =>
  list.filter((x) => !(x.name === to && x.instrument === inst)).map((x) => (x.name === from && x.instrument === inst ? { ...x, name: to } : x))
export const deletePreset = (list: Preset[], inst: InstrumentId, name: string) => list.filter((x) => !(x.name === name && x.instrument === inst))
/** Only what differs from Init is stored, so later default changes still reach old presets. */
export function snapshot(inst: InstrumentId, p: Params): Partial<Params> {
  const d = defaults(inst), out: Partial<Params> = {}
  for (const k of PARAM_IDS) if (Math.abs(p[k] - d[k]) > 1e-9) out[k] = p[k]
  return out
}
