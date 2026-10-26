import { describe, expect, it } from 'vitest'
import { Transport } from '../src/engine/transport'

const fakeClock = () => {
  let t = 0
  return { now: () => t, advance: (s: number) => { t += s } }
}

describe('Transport', () => {
  it('advances beats at the tempo', () => {
    const c = fakeClock(); const tr = new Transport(c.now, 120)
    tr.play(); c.advance(1)
    expect(tr.beat).toBeCloseTo(2)
  })
  it('pause and resume keep the musical position', () => {
    const c = fakeClock(); const tr = new Transport(c.now, 60)
    tr.play(); c.advance(1.5); tr.pause()
    c.advance(10) // long pause
    expect(tr.beat).toBeCloseTo(1.5)
    tr.play(); c.advance(0.5)
    expect(tr.beat).toBeCloseTo(2)
  })
  it('tempo change mid-play does not jump', () => {
    const c = fakeClock(); const tr = new Transport(c.now, 60)
    tr.play(); c.advance(2)
    tr.setBpm(120)
    expect(tr.beat).toBeCloseTo(2)
    c.advance(1)
    expect(tr.beat).toBeCloseTo(4)
  })
  it('timeOf is the inverse of beatAt', () => {
    const c = fakeClock(); const tr = new Transport(c.now, 90)
    tr.seek(3); tr.play(); c.advance(0.7)
    expect(tr.beatAt(tr.timeOf(7.25))).toBeCloseTo(7.25)
  })
})
