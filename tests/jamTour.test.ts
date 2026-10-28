import { describe, expect, it } from 'vitest'
import { TOUR, type TourCtx } from '../src/ui/JamTour'

type Live = Omit<TourCtx, 'start'>
// What the player does to finish each step, in order (the happy path through the tour).
const ACTIONS: ((c: Live) => Live)[] = [
  (c) => ({ ...c, instrument: 'strings', state: 'recording' }),
  (c) => ({ ...c, heard: c.heard + 6 }),
  (c) => ({ ...c, state: 'ready' }),
  (c) => ({ ...c, loop: true }),
  (c) => ({ ...c, state: 'playing' }),
  (c) => ({ ...c, instrument: 'synth' }),
  (c) => ({ ...c, heard: c.heard + 8 }),
  (c) => ({ ...c, tracks: c.tracks + 1 }),
  (c) => ({ ...c, state: 'recording', heard: c.heard + 6 }),
  (c) => ({ ...c, state: 'ready' }),
  (c) => ({ ...c, taught: true }),
  (c) => ({ ...c, loop: !c.loop }),
]

describe('guided jam tour', () => {
  it('every step waits for its action, and finishes once it is done', () => {
    expect(ACTIONS.length).toBe(TOUR.length)
    let live: Live = { instrument: 'piano', state: 'ready', loop: false, tracks: 1, heard: 0, taught: false }
    TOUR.forEach((step, i) => {
      const start = { instrument: live.instrument, tracks: live.tracks, heard: live.heard, loop: live.loop }
      expect(step.done({ ...live, start }), `step ${i + 1} "${step.title}" finished before the player did anything`).toBe(false)
      live = ACTIONS[i](live)
      expect(step.done({ ...live, start }), `step ${i + 1} "${step.title}" did not finish`).toBe(true)
    })
  })

  it('playing too few notes does not finish a "play" step', () => {
    const live: Live = { instrument: 'strings', state: 'recording', loop: false, tracks: 1, heard: 3, taught: false }
    expect(TOUR[1].done({ ...live, start: { instrument: 'strings', tracks: 1, heard: 0, loop: false } })).toBe(false)
  })
})
