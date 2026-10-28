import { useEffect } from 'react'
import type { InstrumentId } from '../audio/audioEngine'
import { Mascot } from './Mascot'
import './JamTour.css'

/** What the guided jam tour can see. `start` is the same picture taken when the current step began. */
export interface TourCtx {
  instrument: InstrumentId
  state: string // Create's transport: 'ready' | 'playing' | 'recording' | …
  loop: boolean
  tracks: number
  heard: number // keys and pads played since the tour began
  taught: boolean // Loop has a keyboard button
  start: { instrument: InstrumentId; tracks: number; heard: number; loop: boolean }
}

export interface TourStep {
  target?: string[] // data-tour names of the controls to use; none = play on the keyboard
  title: string
  text: string
  done: (c: TourCtx) => boolean
}

const played = (c: TourCtx, n: number) => c.heard - c.start.heard >= n

export const TOUR: TourStep[] = [
  { target: ['you-play', 'record'], title: 'Pick a sound, then record',
    text: 'Choose a sound in the "You play" list (try Soft strings): it is the sound of your keyboard. Then click ● Record. You will hear 4 clicks counting you in.',
    done: (c) => c.state === 'recording' },
  { title: 'Play your first part',
    text: 'After the clicks, play on your keyboard: hold a chord (C, E and G together), then another one. Keep going for a few bars.',
    done: (c) => c.state === 'recording' && played(c, 6) },
  { target: ['record'], title: 'Stop recording',
    text: 'Click Stop recording. Your part is now saved on the track, with its sound.',
    done: (c) => c.state !== 'recording' },
  { target: ['loop'], title: 'Turn on Loop',
    text: 'Click 🔁 Loop so it says "Loop on". Your part will repeat round and round.',
    done: (c) => c.loop },
  { target: ['play'], title: 'Play the loop',
    text: 'Click ▶ Play (or press Space). Listen to your part going round.',
    done: (c) => c.state === 'playing' },
  { target: ['you-play'], title: 'Pick a second sound',
    text: 'While it plays, open "You play" again and choose a different sound, for example Synth lead.',
    done: (c) => c.instrument !== c.start.instrument },
  { title: 'Play along',
    text: 'Play a melody on your keyboard over the loop. Any notes are fine: you are jamming!',
    done: (c) => played(c, 8) },
  { target: ['add-track'], title: 'Make room for a new layer',
    text: 'Click + Add track. The new track gets your current sound when you record on it.',
    done: (c) => c.tracks > c.start.tracks },
  { target: ['record'], title: 'Record the new layer',
    text: 'Click ● Record. The loop plays, and everything you play now is added on top. Play your melody again.',
    done: (c) => c.state === 'recording' && played(c, 6) },
  { target: ['record'], title: 'Keep the layer',
    text: 'Click Stop recording. Then click ▶ Play to hear both layers together.',
    done: (c) => c.state !== 'recording' },
  { target: ['teach-loop'], title: 'Control it from the keyboard (optional)',
    text: 'Click Teach next to "Loop on / off", then hold Shift on your MiniLab and press pad 1. If nothing happens, try another pad or button.',
    done: (c) => c.taught },
  { title: 'Use your new button',
    text: 'Press that button on your keyboard: Loop switches off. Press it again and it switches back on. No mouse needed!',
    done: (c) => c.loop !== c.start.loop },
]

/** The floating coach: one step at a time, the control to press lit up. Steps finish themselves when done. */
export function JamCoach({ step, onStep, onEnd }: { step: number; onStep: (i: number) => void; onEnd: () => void }) {
  const s = TOUR[step]
  useEffect(() => {
    const els = (s?.target ?? []).map((t) => document.querySelector<HTMLElement>(`[data-tour="${t}"]`)).filter((e) => e !== null)
    els.forEach((e) => e.classList.add('tour-target'))
    els[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return () => els.forEach((e) => e.classList.remove('tour-target'))
  }, [s])

  if (!s) return (
    <div className="tour-coach card" role="dialog" aria-label="Jam tour finished">
      <div className="row" style={{ gap: 10 }}><Mascot size={44} mood="star" /><b>You made a jam!</b></div>
      <p>That is the whole loop: record a part, loop it, play over it, add layers. Save it with Save, or export it as a MIDI file.</p>
      <button className="btn primary" onClick={onEnd}>Finish</button>
    </div>
  )
  return (
    <div className="tour-coach card" role="dialog" aria-label="Jam tour" aria-live="polite">
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Mascot size={40} mood={s.target ? 'happy' : 'star'} />
        <div className="col" style={{ gap: 0 }}>
          <span className="sub" style={{ fontSize: '0.75rem' }}>Step {step + 1} of {TOUR.length}{s.target ? '' : ' · on your keyboard 🎹'}</span>
          <b>{s.title}</b>
        </div>
      </div>
      <p>{s.text}</p>
      <div className="row" style={{ gap: 6 }}>
        {step > 0 && <button className="btn small" onClick={() => onStep(step - 1)}>Back</button>}
        <button className="btn small" onClick={() => onStep(step + 1)}>Skip</button>
        <span className="spacer" />
        <button className="btn small ghost" onClick={onEnd} aria-label="End the tour">End tour</button>
      </div>
    </div>
  )
}
