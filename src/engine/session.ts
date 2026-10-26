import type { InputEvent } from '../midi/midiInput'
import { PAD_PITCH } from '../music/drums'
import type { Lesson, NoteEvent, PracticeMode } from '../music/types'
import { pc } from '../music/theory'
import { Scorer, type Grade, type Summary } from './scorer'
import { Transport } from './transport'

export interface AudioOut {
  now(): number // audio clock, seconds (scheduling)
  heard(perfMs: number): number // audio-clock time audible at a performance.now() instant
  schedule(pitch: number, time: number, durSec: number, vel?: number): void
  metronome(time: number, accent: boolean): void
  drum?(k: number, time: number, vel: number): void
  panic(): void
}

export interface SessionOptions {
  mode: Exclude<PracticeMode, 'free'>
  hands: 'R' | 'L' | 'both'
  bpm: number
  metronome: boolean
  loop: [number, number] | null // beats; Loop mode region
  calibration: number // seconds; manual extra offset (e.g. Bluetooth) on top of the measured output latency
  endless?: boolean // recording: keep running past the last note until stopped
}

export type SessionState = 'ready' | 'playing' | 'paused' | 'waiting' | 'done'

export interface ImprovSummary { notes: number; inScale: number; distinct: number; span: number; bends: number; vibrato: number }

const LOOKAHEAD_SEC = 0.08
const EPS = 1e-6

/** One engine for Watch, Wait, Rhythm and Loop. Modes only toggle who plays what, whether time stops, and timing scoring. */
export class Session {
  readonly lesson: Lesson
  opts: SessionOptions
  transport: Transport
  scorer: Scorer
  state: SessionState = 'ready'
  userNotes: NoteEvent[]
  autoNotes: NoteEvent[]
  endBeat: number
  startBeat: number
  passes: Summary[] = [] // Loop mode: one summary per pass
  improv: { pitch: number; beat: number }[] = []
  /** pitch → flash for the keyboard renderer (wrong key = red, right = green). */
  flashes = new Map<number, { ok: boolean; until: number }>()
  onDone?: (s: Summary) => void
  onState?: (s: SessionState) => void
  octaveHint: 'up' | 'down' | null = null
  /** Beat at which the count-in ends (clicks always sound before it). */
  countInEnd: number
  /** Lowest tempo used during the current run – a run only counts at the tempo it was actually played. */
  minBpm: number

  private out: AudioOut
  private nextAuto = 0
  private nextClick = 0
  private beatsPerBar: number
  // Loop mode: the next pass's scorer (filled by early downbeat presses) and the previous one (still open for late presses).
  private upcoming: Scorer | null = null
  private closing: Scorer | null = null
  // Loop/jam: notes and clicks of the next pass already scheduled before the wrap.
  private preAuto = 0
  private preClick = 0
  private graceUntil = -Infinity
  // Touch-strip gestures during a jam: a bend counts when the strip passes half-way, vibrato when the mod strip passes 25 %.
  private bends = 0
  private vibratos = 0
  private bendOn = false
  private modOn = false

  constructor(lesson: Lesson, opts: SessionOptions, out: AudioOut) {
    this.lesson = lesson
    this.opts = opts
    this.out = out
    this.beatsPerBar = lesson.timeSig[0]
    this.transport = new Transport(() => out.now(), opts.bpm)
    const all = [...lesson.notes].sort((a, b) => a.start - b.start)
    const mine = (n: NoteEvent) => opts.mode !== 'watch' && lesson.kind === 'play' && (opts.hands === 'both' || n.hand === opts.hands)
    this.userNotes = all.filter(mine)
    this.autoNotes = all.filter((n) => !mine(n))
    this.endBeat = Math.max(0, ...all.map((n) => n.start + n.dur))
    const countIn = lesson.countIn ?? (opts.mode === 'rhythm' || opts.mode === 'loop' || lesson.kind === 'improvise' ? this.beatsPerBar : 2)
    this.countInEnd = opts.mode === 'loop' && opts.loop ? opts.loop[0] : 0
    this.startBeat = this.countInEnd - countIn
    this.minBpm = opts.bpm
    this.scorer = this.newScorer()
  }

  get timed() { return this.opts.mode === 'rhythm' || this.opts.mode === 'loop' }
  get looping() { return this.opts.mode === 'loop' || this.lesson.kind === 'improvise' }
  get loopRange(): [number, number] { return this.opts.mode === 'loop' && this.opts.loop ? this.opts.loop : [0, Math.ceil(this.endBeat / this.beatsPerBar) * this.beatsPerBar] }

  private newScorer() {
    const [a, b] = this.opts.mode === 'loop' ? this.loopRange : [-Infinity, Infinity]
    return new Scorer(this.userNotes.filter((n) => n.start >= a - EPS && n.start < b - EPS), {
      timed: this.timed,
      together: this.lesson.stage >= 4, // from the chords stage, chord keys must be down together
      windowScale: this.lesson.stage <= 2 ? 1.25 : 1,
    })
  }

  private setState(s: SessionState) { if (this.state !== s) { this.state = s; this.onState?.(s) } }

  /** Beat the user hears at performance-time `perfMs`. Scoring, finishing and drawing use this, not the scheduling clock. */
  heardBeat(perfMs = performance.now()) { return this.transport.beatAt(this.out.heard(perfMs) - this.opts.calibration) }
  /** Beat the user hears right now; the renderer draws this so visuals and sound line up. */
  visualBeat() { return this.heardBeat() }

  start() {
    this.seek(this.startBeat)
    this.minBpm = this.opts.bpm
    this.transport.play()
    this.setState('playing')
  }
  pause() { if (this.state === 'playing' || this.state === 'waiting') { this.transport.pause(); this.out.panic(); this.setState('paused') } }
  resume() {
    if (this.state !== 'paused') return
    // Rewind one beat so the user can find the pulse again; replaying already-graded notes there is not an error.
    if (this.timed) { const b = this.transport.beat; this.graceUntil = b; this.seek(Math.max(this.startBeat, b - 1)) }
    this.transport.play(); this.setState('playing')
  }
  restart() {
    this.passes = []; this.improv = []; this.bends = 0; this.vibratos = 0; this.scorer = this.newScorer(); this.upcoming = null; this.closing = null
    this.graceUntil = -Infinity; this.out.panic(); this.start()
  }
  setBpm(bpm: number) {
    this.opts.bpm = bpm
    this.transport.setBpm(bpm)
    if (this.state !== 'ready' && this.state !== 'done') this.minBpm = Math.min(this.minBpm, bpm)
  }

  private seek(b: number) {
    this.transport.seek(b)
    this.nextAuto = this.firstAutoAt(b)
    this.nextClick = Math.ceil(b - EPS)
    this.resetPre()
  }
  private firstAutoAt(b: number) {
    const i = this.autoNotes.findIndex((n) => n.start >= b - EPS)
    return i < 0 ? this.autoNotes.length : i
  }
  private resetPre() {
    const a = this.loopRange[0]
    this.preAuto = this.firstAutoAt(a)
    this.preClick = Math.ceil(a - EPS)
  }

  private click(beatNum: number, at: number, now: number) {
    const on = (this.opts.metronome && this.opts.mode !== 'wait') || beatNum < this.countInEnd
    if (on && at > now - 0.05) this.out.metronome(at, ((beatNum % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0)
  }
  private play(n: NoteEvent, at: number, now: number, spb: number) {
    // After a stall (background tab, slow frame) skip notes that are already over instead of firing them at once.
    if (at + n.dur * spb < now) return
    if (n.drum !== undefined) this.out.drum?.(n.drum, at, n.vel ?? 100)
    else this.out.schedule(n.pitch, at, n.dur * spb * 0.95, n.vel ?? 80)
  }

  /** Called every animation frame. */
  tick() {
    if (this.state !== 'playing' && this.state !== 'waiting') return
    const tr = this.transport
    let beat = tr.beat
    const spb = tr.secPerBeat()
    const [a, b] = this.loopRange

    // Wait mode: stop the clock on the chord the user has to play.
    const g = this.opts.mode === 'wait' ? this.scorer.currentGroup : undefined
    if (g && this.state === 'playing' && beat >= g.start) {
      tr.pause(); tr.seek(g.start); beat = g.start
      this.setState('waiting')
    }

    // Lookahead scheduler for auto-played notes and the metronome.
    if (this.state === 'playing') {
      const now = this.out.now()
      const reach = beat + LOOKAHEAD_SEC / spb
      let horizon = reach
      if (g) horizon = Math.min(horizon, g.start - EPS)
      if (this.looping) horizon = Math.min(horizon, b - EPS)
      while (this.nextAuto < this.autoNotes.length && this.autoNotes[this.nextAuto].start < horizon) {
        const n = this.autoNotes[this.nextAuto++]
        this.play(n, tr.timeOf(n.start), now, spb)
      }
      for (; this.nextClick < horizon; this.nextClick++) this.click(this.nextClick, tr.timeOf(this.nextClick), now)
      // Near the loop end, schedule the start of the next pass too, so its downbeat is sample-accurate.
      if (this.looping && reach > b) {
        const until = a + (reach - b), next = (x: number) => tr.timeOf(b + x - a)
        while (this.preAuto < this.autoNotes.length && this.autoNotes[this.preAuto].start < until) {
          const n = this.autoNotes[this.preAuto++]
          this.play(n, next(n.start), now, spb)
        }
        for (; this.preClick < until; this.preClick++) this.click(this.preClick, next(this.preClick), now)
      }
    }

    const heard = this.heardBeat()
    if (this.timed) this.scorer.advance(heard, spb)
    if (this.closing && heard >= a + this.windowBeats(this.closing, spb)) this.closePass(spb)

    // Loop: wrap seamlessly and score each pass.
    if (this.looping && beat >= b) {
      if (this.opts.mode === 'loop') {
        if (this.closing) this.closePass(spb)
        this.closing = this.scorer
        this.scorer = this.upcoming ?? this.newScorer()
        this.upcoming = null
      }
      // Exact wrap: shift the anchor by the loop length instead of re-reading the clock (no drift per pass).
      tr.shift(a - b)
      this.nextAuto = this.preAuto
      this.nextClick = this.preClick
      this.resetPre()
      return
    }

    const tail = this.timed ? (300 / 1000) / spb : 0
    if (!this.looping && !this.opts.endless && heard >= this.endBeat + tail + 0.5 && (this.opts.mode !== 'wait' || this.scorer.finished)) this.finish()
  }

  private windowBeats(sc: Scorer, spb: number) { return sc.w.max / 1000 / spb }
  private closePass(spb: number) {
    this.closing!.advance(Infinity, spb)
    this.passes.push(this.closing!.summary())
    this.closing = null
  }

  finish() {
    if (this.state === 'done') return
    this.transport.pause()
    this.setState('done')
    if (this.closing) this.closePass(this.transport.secPerBeat())
    if (this.opts.mode === 'loop' && (this.passes.length === 0 || this.scorer.notes.some((n) => n.grade && n.grade !== 'missed'))) {
      this.scorer.advance(Infinity, 1); this.passes.push(this.scorer.summary())
    }
    this.onDone?.(this.opts.mode === 'loop' ? this.bestPass()! : this.scorer.summary())
  }

  bestPass() { return [...this.passes].sort((a, b) => b.accuracy + (b.timing ?? 0) - a.accuracy - (a.timing ?? 0))[0] }

  improvSummary(): ImprovSummary {
    const scale = this.lesson.scale ?? []
    const ps = this.improv.map((x) => x.pitch).filter((p) => p < PAD_PITCH) // drum hits are not melody
    return {
      notes: ps.length,
      inScale: ps.length ? ps.filter((p) => scale.includes(pc(p))).length / ps.length : 0,
      distinct: new Set(ps).size,
      span: ps.length ? Math.max(...ps) - Math.min(...ps) : 0,
      bends: this.bends,
      vibrato: this.vibratos,
    }
  }

  /** Physical (or simulated) key input. */
  input(e: InputEvent): { grade?: Grade; ok: boolean } | null {
    if (this.state === 'ready' || this.state === 'done' || this.state === 'paused') return null
    if (e.type === 'bend') { const on = Math.abs(e.value) > 0.5; if (on && !this.bendOn) this.bends++; this.bendOn = on; return null }
    if (e.type === 'mod') { const on = e.value > 0.25; if (on && !this.modOn) this.vibratos++; this.modOn = on; return null }
    if (e.type === 'sustain') return null
    // A drum pad scores like a key whose "pitch" is PAD_PITCH + pad number.
    if (e.type === 'pad') e = { type: 'on', pitch: PAD_PITCH + e.pad, vel: e.vel, channel: e.channel, time: e.time, source: e.source }
    const beat = this.heardBeat(e.time)
    const spb = this.transport.secPerBeat()
    const [a, b] = this.loopRange, L = b - a

    if (e.type === 'off') {
      this.scorer.release(e.pitch, beat); this.closing?.release(e.pitch, beat + L); this.upcoming?.release(e.pitch, beat - L)
      return null
    }

    if (this.lesson.kind === 'improvise') {
      this.improv.push({ pitch: e.pitch, beat })
      const ok = e.pitch >= PAD_PITCH || (this.lesson.scale ?? []).includes(pc(e.pitch))
      this.flash(e.pitch, ok)
      return { ok }
    }
    if (this.opts.mode === 'watch') return null
    if (this.timed && beat < this.graceUntil && this.scorer.notes.some((n) => n.grade && n.grade !== 'missed' && n.pitch === e.pitch && Math.abs(n.start - beat) < 1.5)) return null

    // Loop mode: a late press for the pass that just ended, or an early press for the next pass's downbeat.
    let target = this.scorer, at = beat
    if (this.opts.mode === 'loop') {
      const w = this.windowBeats(this.scorer, spb)
      if (this.closing && beat < a + w && this.closing.canMatch(e.pitch, beat + L, spb)) { target = this.closing; at = beat + L }
      else if (beat > b - w && !this.scorer.canMatch(e.pitch, beat, spb) && (this.upcoming ??= this.newScorer()).canMatch(e.pitch, beat - L, spb)) { target = this.upcoming; at = beat - L }
    }

    const r = target.press(e.pitch, at, spb)
    const ok = r.kind === 'hit'
    this.flash(e.pitch, ok)
    // Octave hint: the played key is exactly an octave from what is expected.
    const last = target.wrong[target.wrong.length - 1]
    if (!ok && last?.expected != null && Math.abs(last.expected - e.pitch) === 12) this.octaveHint = last.expected > e.pitch ? 'up' : 'down'
    else if (ok) this.octaveHint = null
    if (r.groupDone && this.state === 'waiting') { this.transport.play(); this.setState('playing') }
    return { grade: r.grade, ok }
  }

  private flash(pitch: number, ok: boolean) { this.flashes.set(pitch, { ok, until: performance.now() + 350 }) }
}
