import { useSyncExternalStore } from 'react'
import type { InstrumentId } from '../audio/audioEngine'
import type { KirtanSettings } from '../audio/kirtan'
import type { Kit } from '../music/drums'
import type { ArpSettings, ChordSettings } from '../audio/arp'
import type { CCMode } from '../audio/controls'
import type { PadTouch } from '../midi/midiInput'
import type { Params, Preset, Target } from '../audio/sound'
import type { Attempt } from '../engine/feedback'
import type { NoteEvent } from '../music/types'
import type { LabelMode } from '../render/pianoRenderer'

/** A value persisted in localStorage. Reads never throw: a broken or blocked storage falls back to the default. */
export function persisted<T extends object>(key: string, initial: T) {
  const k = `pianoapp.v1.${key}`
  let value: T = initial
  try {
    const raw = localStorage.getItem(k)
    if (raw) value = { ...initial, ...JSON.parse(raw) }
  } catch { /* private mode or corrupt JSON: keep defaults */ }
  const subs = new Set<() => void>()
  // Another tab saved: take its value, so this tab's next write doesn't erase that tab's progress.
  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => {
    if (e.key !== k || e.newValue === null) return
    try { value = { ...initial, ...JSON.parse(e.newValue) }; subs.forEach((f) => f()) } catch { /* ignore corrupt write */ }
  })
  return {
    get: () => value,
    /** Returns false when the browser refused to store it (storage full or blocked); the value stays in memory. */
    set(patch: Partial<T> | ((v: T) => T)): boolean {
      value = typeof patch === 'function' ? patch(value) : { ...value, ...patch }
      let ok = true
      try { localStorage.setItem(k, JSON.stringify(value)) } catch { ok = false }
      subs.forEach((f) => f())
      return ok
    },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
  }
}

export function useStore<T extends object>(s: ReturnType<typeof persisted<T>>): T {
  return useSyncExternalStore(s.subscribe, s.get)
}

export interface Settings {
  onboarded: boolean
  midiPort: string
  midiChannel: number
  padMode: 'drums' | 'ignore' | 'notes' // what the MiniLab pads (channel 10) do
  padBase: number // note number pad 1 sends
  padTouch: PadTouch // lift light pad taps, or play every hit at full strength
  volume: number
  instrument: InstrumentId
  labels: LabelMode
  beatsVisible: number
  metronome: boolean
  calibrationMs: number
  lowestKey: number | null // what the user's lowest key sent during setup
  keyCount: number
  computerKeys: boolean // play with the computer keyboard (A S D F …)
  theme: 'light' | 'dark' | 'system'
  audioBuffer: 'interactive' | 'balanced' // OS audio buffer: 'balanced' trades a few ms of latency for fewer crackles
  padKit: Kit // what the pads play: the drum kit or the kirtan kit (dholak, kartals …)
  kirtan: KirtanSettings // drone and rhythm loop under free play
}

export const settings = persisted<Settings>('settings', {
  onboarded: false,
  midiPort: 'auto',
  midiChannel: 0,
  padMode: 'drums',
  padBase: 36,
  padTouch: 'light',
  volume: 0.8,
  instrument: 'piano',
  labels: 'name',
  beatsVisible: 6,
  metronome: true,
  calibrationMs: 0,
  lowestKey: null,
  keyCount: 25,
  computerKeys: true,
  theme: 'light',
  audioBuffer: 'interactive',
  padKit: 'standard',
  kirtan: { drone: 'off', sa: 0, rhythm: 'off', level: 0.7 },
})

export interface LessonProgress { stars: number; bestAccuracy: number; bestTiming: number | null; attempts: Attempt[] }
export interface Progress {
  lessons: Record<string, LessonProgress>
  days: Record<string, number> // 'YYYY-MM-DD' → minutes practised
  improvisations: number
}
export const progress = persisted<Progress>('progress', { lessons: {}, days: {}, improvisations: 0 })

export function recordAttempt(lessonId: string, a: Attempt) {
  progress.set((p) => {
    const cur = p.lessons[lessonId] ?? { stars: 0, bestAccuracy: 0, bestTiming: null, attempts: [] }
    return {
      ...p,
      lessons: {
        ...p.lessons,
        [lessonId]: {
          stars: Math.max(cur.stars, a.stars),
          bestAccuracy: Math.max(cur.bestAccuracy, a.accuracy),
          bestTiming: a.timing === null ? cur.bestTiming : Math.max(cur.bestTiming ?? 0, a.timing),
          attempts: [...cur.attempts, a].slice(-30),
        },
      },
    }
  })
}

const today = () => new Date().toLocaleDateString('sv') // YYYY-MM-DD in local time
export function logPractice(minutes: number) {
  progress.set((p) => ({ ...p, days: { ...p.days, [today()]: (p.days[today()] ?? 0) + minutes } }))
}
export function streak(days: Record<string, number>): number {
  let n = 0
  const d = new Date()
  if (!days[d.toLocaleDateString('sv')]) d.setDate(d.getDate() - 1) // today not practised yet doesn't break the streak
  while (days[d.toLocaleDateString('sv')]) { n++; d.setDate(d.getDate() - 1) }
  return n
}

export interface Track { id: string; name: string; instrument: InstrumentId; notes: NoteEvent[]; muted?: boolean; drums?: boolean }
export interface Composition { id: string; name: string; bpm: number; timeSig: [number, number]; tracks: Track[]; updated: number }
// shortcut: compositions live in localStorage (~5 MB cap); move to IndexedDB if users keep hundreds of long takes.
export const library = persisted<{ items: Composition[] }>('compositions', { items: [] })
/** The composition open in Create, saved or not – so leaving the page never loses work. */
export const draft = persisted<{ comp: Composition | null; dirty: boolean }>('draft', { comp: null, dirty: false })

/** The current sound: stored params per instrument (only what differs from Init), the loaded preset name, perform FX. */
export interface SoundState {
  params: Partial<Record<InstrumentId, Partial<Params>>>
  preset: Partial<Record<InstrumentId, string>>
  bpm: number // arpeggiator and synced delay; Create can set its tempo here
  arp: ArpSettings
  chord: ChordSettings
}
export const sound = persisted<SoundState>('sound', {
  params: {},
  preset: {},
  bpm: 100,
  arp: { on: false, mode: 'up', rate: 1, octaves: 1, gate: 0.6, latch: false },
  chord: { on: false, shape: [0, 4, 7] },
})
export const userPresets = persisted<{ items: Preset[] }>('presets', { items: [] })
/** MIDI learn: CC number → what it drives. `mode` 'auto' detects endless-encoder (relative) output. */
export const ccMap = persisted<{ map: Record<number, { target: Target; mode: CCMode }> }>('ccmap', { map: {} })
