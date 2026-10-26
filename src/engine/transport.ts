// The one musical clock. Position is in beats, anchored to an audio-clock reading (seconds).
// Renderer, scheduler and scorer all read beatAt(); nothing else keeps time.

export class Transport {
  bpm: number
  playing = false
  private anchorBeat = 0
  private anchorTime = 0
  private clock: () => number
  /** `clock` returns seconds on the audio clock (AudioContext.currentTime). Injected for tests. */
  constructor(clock: () => number, bpm = 80) { this.clock = clock; this.bpm = bpm }

  /** Beat position at audio time `t` (defaults to now). */
  beatAt(t = this.clock()): number {
    return this.playing ? this.anchorBeat + ((t - this.anchorTime) * this.bpm) / 60 : this.anchorBeat
  }
  get beat() { return this.beatAt() }

  /** Audio time at which beat `b` will sound if the transport keeps running. */
  timeOf(b: number): number { return this.anchorTime + ((b - this.anchorBeat) * 60) / this.bpm }

  private reanchor() { this.anchorBeat = this.beatAt(); this.anchorTime = this.clock() }

  play() { if (this.playing) return; this.anchorTime = this.clock(); this.playing = true }
  pause() { if (!this.playing) return; this.reanchor(); this.playing = false }
  seek(b: number) { this.anchorBeat = b; this.anchorTime = this.clock() }
  /** Jump by an exact number of beats without re-reading the clock (seamless loop wrap, no drift). */
  shift(deltaBeats: number) { this.anchorBeat += deltaBeats }
  setBpm(bpm: number) { this.reanchor(); this.bpm = bpm }
  secPerBeat() { return 60 / this.bpm }
}
