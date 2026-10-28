import { audio } from '../audio/audioEngine'
import { kirtan } from '../audio/kirtan'
import { kit } from '../music/drums'
import { allSounds, handleCC } from '../audio/controls'
import { perform } from '../audio/perform'
import { midi } from '../midi/midiInput'
import type { Trail } from '../render/pianoRenderer'
import { settings, sound } from '../store/store'
import { initStats } from '../analytics'

/** Recent notes for the Free-play "rising notes" view. */
export const trails: Trail[] = []
/** pad → performance.now() until which the drawn pad stays lit. */
export const padHits: number[] = []

// Computer keyboard as a fallback instrument (Synthesia layout): A W S E D F T G Y H U J K O L P ;
const CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon']
export const computerKeys = { base: 60 }

const downKeys = new Map<string, number>() // code → pitch, so an octave change mid-press releases the right note
let started = false
let lastInstrument = ''
let lastPadKit = ''
export function initLiveInput() {
  if (started) return
  started = true
  // Sound first: this listener is registered before any screen's, so audio is triggered before scoring/drawing.
  const wake = () => {
    if (audio.running) return
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (ua?.hasBeenActive) void audio.start() // allowed after any earlier tap; the MiniLab alone can't unlock audio
  }
  midi.on((e) => {
    if (e.type === 'on' || e.type === 'pad') wake()
    if (e.type === 'on') {
      perform.noteOn(e.pitch, e.vel) // straight to audio.noteOn unless arp/chord memory are on in free play
      trails.push({ pitch: e.pitch, on: performance.now(), off: null })
      if (trails.length > 300) trails.splice(0, trails.length - 300)
    } else if (e.type === 'off') {
      perform.noteOff(e.pitch)
      for (let i = trails.length - 1; i >= 0; i--) if (trails[i].pitch === e.pitch && trails[i].off === null) { trails[i].off = performance.now(); break }
    } else if (e.type === 'pad') { audio.drum(e.pad, undefined, e.vel); padHits[e.pad] = performance.now() + 140 }
    else if (e.type === 'bend') audio.setBend(e.value)
    else if (e.type === 'mod') audio.setMod(e.value)
    else audio.setSustain(e.down)
  })
  midi.onCC((e) => handleCC(e.cc, e.raw))
  window.addEventListener('unhandledrejection', (e) => { audio.lastError = String(e.reason?.message ?? e.reason) })
  initStats()

  const applySettings = () => {
    const s = settings.get()
    midi.filter = { port: s.midiPort, channel: s.midiChannel, pads: s.padMode, padBase: s.padBase }
    // Only on a real change: other settings writes (metronome, labels, zoom) must not undo a lesson's own instrument.
    if (s.instrument !== lastInstrument) { lastInstrument = s.instrument; audio.instrument = s.instrument }
    if (s.padKit !== lastPadKit) { lastPadKit = s.padKit; kit.id = s.padKit } // only on a change: a kirtan lesson sets its own kit
    kirtan.configure(s.kirtan)
    audio.latencyHint = s.audioBuffer // read when audio starts, so a change applies after a reload
    if (audio.started) audio.setVolume(s.volume)
  }
  applySettings()
  settings.subscribe(applySettings)
  // The engine keeps these until start(), so the saved sound is applied as soon as audio starts.
  const applySound = () => {
    const s = sound.get()
    audio.setSounds(allSounds())
    audio.setTempo(s.bpm)
    perform.configure(s.arp, s.chord)
  }
  applySound()
  sound.subscribe(applySound)

  const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)
  window.addEventListener('keydown', (e) => {
    if (e.repeat || typing(e) || e.ctrlKey || e.metaKey || e.altKey || !settings.get().computerKeys) return
    if (e.code === 'KeyZ') { computerKeys.base = Math.max(24, computerKeys.base - 12); return }
    if (e.code === 'KeyX') { computerKeys.base = Math.min(96, computerKeys.base + 12); return }
    // Number keys 1–8 stand in for the 8 drum pads.
    const pad = /^Digit([1-8])$/.exec(e.code)
    if (pad) { void audio.start(); midi.emit({ type: 'pad', pad: +pad[1] - 1, vel: 100, channel: 10, time: performance.now(), source: 'computer' }); return }
    const i = CODES.indexOf(e.code)
    if (i < 0) return
    void audio.start()
    downKeys.set(e.code, computerKeys.base + i)
    midi.emit({ type: 'on', pitch: computerKeys.base + i, vel: 90, channel: 1, time: performance.now(), source: 'computer' })
  })
  window.addEventListener('keyup', (e) => {
    const p = downKeys.get(e.code)
    downKeys.delete(e.code)
    if (p !== undefined) midi.emit({ type: 'off', pitch: p, channel: 1, time: performance.now(), source: 'computer' })
  })
  // A hidden tab stops animation frames and may miss key-ups: release everything.
  document.addEventListener('visibilitychange', () => { if (document.hidden) midi.releaseAll() })
}
