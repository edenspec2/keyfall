import type { NoteEvent } from '../music/types'
import { currentDrums, PAD_PITCH } from '../music/drums'
import { isBlack, noteName, noteNameOct } from '../music/theory'
import type { FingerSpot } from '../music/fingering'
import type { Grade } from '../engine/scorer'

export type LabelMode = 'none' | 'name' | 'octave'

export interface Trail { pitch: number; on: number; off: number | null; ok?: boolean } // performance.now() ms

/** Everything the renderer reads each frame. Plain mutable data – no React. */
export interface Scene {
  beat: number
  notes: NoteEvent[]
  grades?: Map<NoteEvent, Grade> // keyed by the lesson note object
  userHands: 'R' | 'L' | 'both' | 'none'
  range: [number, number]
  held: Map<number, unknown> // physical keys down
  flashes?: Map<number, { ok: boolean; until: number }>
  pending?: number[] // Wait mode: keys to press now
  labels: LabelMode
  beatsVisible: number // vertical zoom (scroll speed)
  beatsPerBar: number
  loop?: [number, number] | null
  highlightPcs?: number[] // scale/chord tones shown on the keys
  trails?: Trail[] // Free play: notes rising from the keys
  waiting?: boolean
  live?: boolean // transport running: drives the beat pulse
  pads?: boolean // show the 8 drum pads beside the keyboard
  padShare?: number // fraction of the width for the pads (default 0.3; more for drum-only lessons)
  padHits?: number[] // pad → performance.now() until which it is lit (live pad presses)
  fingers?: FingerSpot[] // hand position: which finger rests on which key
  autoAlpha?: number // opacity of notes the app plays itself (Watch mode and demos show them fully)
}

/** Where the keyboard, the pad lanes and the hit line sit. Shared by drawing and by mouse hit-testing. */
export function sceneGeometry(W: number, H: number, pads?: boolean, padShare = 0.3) {
  const kbH = Math.min(150, Math.max(90, H * 0.24))
  const padX0 = W * (1 - padShare), padW = (W - padX0) / 8
  const kbW = pads ? padX0 - W * 0.02 : W
  return { kbH, hitY: H - kbH, kbW, padX0, padW, padTop: H - kbH + 10, padSize: kbH - 20 }
}

// ───────────────────────── Palettes ─────────────────────────
export type RenderTheme = 'light' | 'dark'
interface Palette {
  hands: Record<'R' | 'L', [string, string]> // [lighter, deeper]
  stage: [string, string] // top, bottom of the note area
  lane: string; cLine: string; beat: string; bar: string; barText: string; loop: string
  floor: string // beat-pulse glow above the hit line
  line: string; lineWait: string
  bed: string; white: string; whiteLip: string; whiteShade: [string, string]; black: string; blackLip: string; blackShine: string
  keyText: string; middleC: string; dot: string
  heldKey: string; heldKeyBlack: string
  padBed: string; padIdle: string; padText: string
  label: string // text on a note
  miss: string; ok: string; bad: string; warn: string; perfect: string
  judgeHalo: string; milestone: string; dust: string
  additive: boolean // 'lighter' blending only looks right on a dark stage
  autoAlpha: number // notes the app plays itself
}
const PALETTES: Record<RenderTheme, Palette> = {
  light: {
    hands: { R: ['#22b8f0', '#4f46e5'], L: ['#fb923c', '#e11d48'] },
    stage: ['#f7f8fc', '#e9edf8'],
    lane: 'rgba(30,41,90,0.024)', cLine: 'rgba(30,41,90,0.09)', beat: 'rgba(30,41,90,0.05)', bar: 'rgba(30,41,90,0.13)', barText: 'rgba(30,41,90,0.42)', loop: 'rgba(99,102,241,0.08)',
    floor: 'rgba(99,102,241,0.16)',
    line: 'rgba(79,70,229,0.75)', lineWait: 'rgba(245,158,11,0.95)',
    bed: '#dfe3ee', white: '#ffffff', whiteLip: '#c9cfdd', whiteShade: ['rgba(15,23,42,0.10)', 'rgba(15,23,42,0)'], black: '#1d2233', blackLip: '#0b0e17', blackShine: 'rgba(255,255,255,0.14)',
    keyText: 'rgba(30,41,59,0.45)', middleC: '#4f46e5', dot: 'rgba(99,102,241,0.55)',
    heldKey: '#a5b4fc', heldKeyBlack: '#6366f1',
    padBed: '#e3e7f1', padIdle: '#ffffff', padText: 'rgba(30,41,59,0.6)',
    label: 'rgba(255,255,255,0.95)',
    miss: '#cbd2e0', ok: '#10b981', bad: '#ef4444', warn: '#f59e0b', perfect: '#06b6d4',
    judgeHalo: 'rgba(255,255,255,0.9)', milestone: 'rgba(79,70,229,0.9)', dust: '',
    additive: false, autoAlpha: 0.38,
  },
  dark: {
    hands: { R: ['#67e8f9', '#3b82f6'], L: ['#fdba74', '#f43f5e'] },
    stage: ['#0b0f1c', '#121a30'],
    lane: 'rgba(255,255,255,0.025)', cLine: 'rgba(255,255,255,0.07)', beat: 'rgba(255,255,255,0.045)', bar: 'rgba(255,255,255,0.12)', barText: 'rgba(255,255,255,0.35)', loop: 'rgba(139,92,246,0.09)',
    floor: 'rgba(99,102,241,0.26)',
    line: 'rgba(165,180,252,0.85)', lineWait: 'rgba(251,191,36,0.9)',
    bed: '#05070d', white: '#eef1f7', whiteLip: '#9aa2b5', whiteShade: ['rgba(0,0,0,0.20)', 'rgba(0,0,0,0)'], black: '#191d29', blackLip: '#07080d', blackShine: 'rgba(255,255,255,0.12)',
    keyText: 'rgba(20,22,32,0.45)', middleC: '#4f46e5', dot: 'rgba(129,140,248,0.75)',
    heldKey: '#a5b4fc', heldKeyBlack: '#818cf8',
    padBed: '#0a0d16', padIdle: '#1c2232', padText: 'rgba(232,235,244,0.7)',
    label: 'rgba(8,10,18,0.85)',
    miss: '#3a4256', ok: '#34d399', bad: '#f87171', warn: '#fbbf24', perfect: '#67e8f9',
    judgeHalo: 'rgba(5,6,10,0.75)', milestone: 'rgba(199,210,254,0.85)', dust: 'rgba(200,210,255,0.14)',
    additive: true, autoAlpha: 0.42,
  },
}
let pal = PALETTES.light
let themeName: RenderTheme = 'light'
/** Switch the canvas palette (the app calls this when the theme changes). Cached layers are rebuilt. */
export function setRenderTheme(t: RenderTheme) { if (t !== themeName) { themeName = t; pal = PALETTES[t]; stageCache.key = ''; kbCache.key = ''; glows.clear() } }
/** The current theme's colour for a hand (sparks and pops use it). */
export const noteColor = (hand: 'R' | 'L') => pal.hands[hand][0]

const FONT = '-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const DISPLAY = '-apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'

/** Judgment text; 'hit' is Wait mode (no timing), 'wrong' a key that wasn't asked for. */
export type Judgment = Grade | 'wrong'
const JUDGE_TEXT: Record<Judgment, string> = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', missed: 'MISS', hit: '✓', wrong: '✗' }
const judgeColor = (k: Judgment) => (k === 'perfect' ? pal.perfect : k === 'good' || k === 'hit' ? pal.ok : k === 'early' ? pal.warn : k === 'late' ? pal.hands.L[0] : pal.bad)

const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
/** Phones (light engine): draw like reduced motion – no blurred glow, sparks or dust – to leave the CPU to the audio. */
export const renderOpts = { lite: false }

/**
 * Short-lived hit effects (judgment pops, shockwave rings, sparks, combo milestones) and per-key press depth.
 * Fixed pools reused as ring buffers, so pushing and drawing never allocates.
 */
export class Effects {
  pops = Array.from({ length: 24 }, () => ({ pitch: 0, t0: -1e9, kind: 'hit' as Judgment }))
  rings = Array.from({ length: 24 }, () => ({ pitch: 0, t0: -1e9, color: '' }))
  sparks = Array.from({ length: 160 }, () => ({ pitch: 0, t0: -1e9, vx: 0, vy: 0, size: 0, color: '' }))
  mile = { n: 0, t0: -1e9 }
  depth = new Float32Array(PAD_PITCH + 8) // 0 = key up, 1 = fully pressed (eased)
  last = 0
  private pi = 0
  private ri = 0
  private si = 0

  judge(pitch: number, kind: Judgment, now: number, color = judgeColor(kind)) {
    const p = this.pops[this.pi++ % this.pops.length]
    p.pitch = pitch; p.t0 = now; p.kind = kind
    if (kind === 'missed' || kind === 'wrong') return
    const r = this.rings[this.ri++ % this.rings.length]
    r.pitch = pitch; r.t0 = now; r.color = color
    if (reduceMotion?.matches) return
    const n = kind === 'perfect' ? 10 : 6
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.si++ % this.sparks.length]
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2 // mostly upward fan
      const v = 140 + Math.random() * 220
      s.pitch = pitch; s.t0 = now; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v; s.size = 2 + Math.random() * 2.5; s.color = color
    }
  }

  milestone(n: number, now: number) { this.mile.n = n; this.mile.t0 = now }

  clear() {
    for (const p of this.pops) p.t0 = -1e9
    for (const r of this.rings) r.t0 = -1e9
    for (const s of this.sparks) s.t0 = -1e9
    this.mile.t0 = -1e9
  }
}

// ───────────────────────── Geometry caches ─────────────────────────
export interface KeyRect { x: number; w: number; black: boolean }
/** Key geometry for a pitch range; white keys equal width, black keys centred on the gap. */
export function keyLayout(lo: number, hi: number, width: number) {
  const whites: number[] = []
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p)
  const ww = width / whites.length
  const x = new Map<number, KeyRect>()
  whites.forEach((p, i) => x.set(p, { x: i * ww, w: ww, black: false }))
  for (let p = lo; p <= hi; p++) if (isBlack(p)) {
    const left = x.get(p - 1)
    if (left) x.set(p, { x: left.x + ww * 0.68, w: ww * 0.62, black: true })
  }
  return x
}
// The layout only changes with the range or the width, so it is built once, not every frame.
const layoutCache = { key: '', layout: new Map<number, KeyRect>(), whites: [] as [number, KeyRect][], blacks: [] as [number, KeyRect][] }
function cachedLayout(lo: number, hi: number, w: number) {
  const key = `${lo}|${hi}|${w}`
  if (layoutCache.key !== key) {
    layoutCache.key = key
    layoutCache.layout = keyLayout(lo, hi, w)
    layoutCache.whites = [...layoutCache.layout].filter(([, k]) => !k.black)
    layoutCache.blacks = [...layoutCache.layout].filter(([, k]) => k.black)
  }
  return layoutCache
}

/** Display range: always whole octaves C..C covering the requested range. */
export function displayRange(lo: number, hi: number): [number, number] {
  return [Math.floor(lo / 12) * 12, Math.max(Math.ceil(hi / 12) * 12, Math.floor(lo / 12) * 12 + 12)]
}

/**
 * Notes sorted by onset in typed arrays, so each frame finds the visible ones with two binary searches
 * instead of testing every note of the piece.
 */
interface NoteIndex { order: Uint32Array; starts: Float64Array; maxDur: number }
const indexCache = new WeakMap<NoteEvent[], NoteIndex>()
export function noteIndex(notes: NoteEvent[]): NoteIndex {
  let ix = indexCache.get(notes)
  if (!ix) {
    const order = Uint32Array.from(notes.keys()).sort((a, b) => notes[a].start - notes[b].start)
    const starts = Float64Array.from(order, (i) => notes[i].start)
    let maxDur = 0
    for (const n of notes) if (n.dur > maxDur) maxDur = n.dur
    ix = { order, starts, maxDur }
    indexCache.set(notes, ix)
  }
  return ix
}
/** First index whose value is ≥ v. */
export function lowerBound(a: Float64Array, v: number) {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m }
  return lo
}
/** Indices (into `notes`) of the notes that overlap [from, to) in beats. */
export function visibleNotes(notes: NoteEvent[], from: number, to: number, out: number[]): number[] {
  const ix = noteIndex(notes)
  out.length = 0
  const end = lowerBound(ix.starts, to)
  for (let i = lowerBound(ix.starts, from - ix.maxDur); i < end; i++) {
    const n = notes[ix.order[i]]
    if (n.start + n.dur > from) out.push(ix.order[i])
  }
  return out
}

// ───────────────────────── Drawing helpers ─────────────────────────
function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2)))
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t)
const backOut = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const scratch: number[] = [] // reused visible-note list
const fontCache = new Map<number, string>()
const labelFont = (px: number) => { let f = fontCache.get(px); if (!f) { f = `650 ${px}px ${FONT}`; fontCache.set(px, f) } return f }

/**
 * The stage background (gradient, key lanes, octave lines) and the resting keyboard only change when the size,
 * range, labels or theme change, so they are painted once into offscreen canvases and copied each frame.
 */
const stageCache = { key: '', canvas: null as OffscreenCanvas | null, floor: null as CanvasGradient | null }
const kbCache = { key: '', canvas: null as OffscreenCanvas | null }
const glows = new Map<string, CanvasGradient>()
const noteFills = { key: '', fills: new Map<string, CanvasGradient>() }

function stageLayer(ctx: CanvasRenderingContext2D, dpr: number, W: number, hitY: number, layout: Map<number, KeyRect>, padX0: number | null, padW: number) {
  const key = `${W}|${hitY}|${dpr}|${layoutCache.key}|${padX0}|${padW}|${themeName}`
  if (stageCache.key === key && stageCache.canvas) return stageCache
  stageCache.key = key
  const c = new OffscreenCanvas(Math.max(1, Math.ceil(W * dpr)), Math.max(1, Math.ceil(hitY * dpr)))
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  const bg = g.createLinearGradient(0, 0, 0, hitY)
  bg.addColorStop(0, pal.stage[0]); bg.addColorStop(1, pal.stage[1])
  g.fillStyle = bg
  g.fillRect(0, 0, W, hitY)
  g.fillStyle = pal.lane
  for (const k of layout.values()) if (k.black) g.fillRect(k.x, 0, k.w, hitY)
  g.fillStyle = pal.cLine
  for (const [p, k] of layout) if (p % 12 === 0) g.fillRect(Math.round(k.x), 0, 1, hitY)
  if (padX0 !== null) for (let d = 0; d <= 8; d++) g.fillRect(Math.round(padX0 + d * padW), 0, 1, hitY)
  stageCache.canvas = c
  stageCache.floor = ctx.createLinearGradient(0, hitY * 0.55, 0, hitY)
  stageCache.floor.addColorStop(0, 'rgba(0,0,0,0)'); stageCache.floor.addColorStop(1, pal.floor)
  return stageCache
}

function keyboardLayer(dpr: number, W: number, kbW: number, kbH: number, labels: LabelMode, dots: string) {
  const key = `${kbW}|${kbH}|${dpr}|${layoutCache.key}|${labels}|${dots}|${themeName}|${W}`
  if (kbCache.key === key && kbCache.canvas) return kbCache.canvas
  kbCache.key = key
  const c = new OffscreenCanvas(Math.max(1, Math.ceil(W * dpr)), Math.max(1, Math.ceil(kbH * dpr)))
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  g.fillStyle = pal.bed
  g.fillRect(0, 0, kbW, kbH)
  const hl = dots ? dots.split(',').map(Number) : []
  for (const [p, k] of layoutCache.whites) drawKey(g, p, k, 0, kbH, pal.white, labels, hl.includes(p % 12))
  for (const [p, k] of layoutCache.blacks) drawKey(g, p, k, 0, kbH, pal.black, labels, hl.includes(p % 12))
  kbCache.canvas = c
  return c
}

/** One key at press depth `d` (0..1) with fill `fill`; y0 is the top of the keyboard. */
function drawKey(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, p: number, k: KeyRect, y0: number, kbH: number, fill: string, labels: LabelMode, dot: boolean, d = 0) {
  const black = k.black
  const h = black ? kbH * 0.62 : kbH
  const kx = k.x + (black ? 0 : 1), kw = k.w - (black ? 0 : 2)
  const lip = black ? 7 - 4 * d : 6 - 4 * d // the front edge shrinks as the key goes down
  g.fillStyle = black ? pal.blackLip : pal.whiteLip
  roundRect(g, kx, y0, kw, h, black ? 3 : 6)
  g.fill()
  g.fillStyle = fill
  roundRect(g, kx, y0 + d * 1.5, kw, h - lip - d * 1.5, black ? 3 : 6)
  g.fill()
  if (!black) {
    // A soft shade under the key bed's front rail.
    const sh = g.createLinearGradient(0, y0, 0, y0 + 14)
    sh.addColorStop(0, pal.whiteShade[0]); sh.addColorStop(1, pal.whiteShade[1])
    g.fillStyle = sh
    g.fillRect(kx, y0, kw, 14)
  } else {
    g.fillStyle = pal.blackShine
    g.fillRect(kx + 2, y0 + h - lip - 2, kw - 4, 1)
  }
  if (dot) {
    g.fillStyle = pal.dot
    g.beginPath(); g.arc(k.x + k.w / 2, y0 + h - (black ? 14 : 30), black ? 3.5 : 4.5, 0, Math.PI * 2); g.fill()
  }
  if (!black && labels !== 'none') {
    g.fillStyle = p === 60 ? pal.middleC : pal.keyText
    g.font = `${p === 60 ? 700 : 500} ${Math.min(11, k.w * 0.4)}px ${FONT}`
    g.textAlign = 'center'
    g.fillText(labels === 'octave' || p % 12 === 0 ? noteNameOct(p) : noteName(p), k.x + k.w / 2, y0 + h - lip - 6)
    g.textAlign = 'left'
  }
}

/** Screen-space note fill: faint at the top of the stage, full colour at the hit line (notes "light up" as they land). */
function noteFill(ctx: CanvasRenderingContext2D, hitY: number, c1: string, c2: string) {
  const key = `${hitY}|${themeName}`
  if (noteFills.key !== key) { noteFills.key = key; noteFills.fills.clear() }
  const id = c1 + c2
  let g = noteFills.fills.get(id)
  if (!g) {
    g = ctx.createLinearGradient(0, 0, 0, hitY)
    g.addColorStop(0, c1 + 'b0'); g.addColorStop(0.55, c1); g.addColorStop(1, c2)
    noteFills.fills.set(id, g)
  }
  return g
}
function glowFor(ctx: CanvasRenderingContext2D, color: string, hitY: number) {
  const id = `${color}|${hitY}`
  let g = glows.get(id)
  if (!g) {
    g = ctx.createLinearGradient(0, hitY - 110, 0, hitY)
    g.addColorStop(0, color + '00'); g.addColorStop(1, color + (pal.additive ? '70' : '48'))
    glows.set(id, g)
  }
  return g
}

// Buckets of note shapes filled with one call each (per colour and state), instead of one fill per note.
type Bucket = { path: Path2D; c1: string; c2: string; alpha: number; solid?: string }
const buckets = new Map<string, Bucket>()
function bucket(key: string, c1: string, c2: string, alpha: number, solid?: string) {
  let b = buckets.get(key)
  if (!b) { b = { path: new Path2D(), c1, c2, alpha, solid }; buckets.set(key, b) }
  return b
}

const DUST = Float32Array.from({ length: 96 }, (_, i) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1)

export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, s: Scene, now: number, fx?: Effects) {
  const [lo, hi] = s.range
  const geo = sceneGeometry(W, H, s.pads, s.padShare)
  const { kbH, hitY } = geo
  const { layout, whites, blacks } = cachedLayout(lo, hi, geo.kbW)
  const dpr = ctx.getTransform().a || 1
  const laneX = (d: number) => geo.padX0 + d * geo.padW
  const pxPerBeat = hitY / s.beatsVisible
  const yOf = (beat: number) => hitY - (beat - s.beat) * pxPerBeat
  const calm = renderOpts.lite || !!reduceMotion?.matches
  const dt = fx ? Math.min(0.05, Math.max(0, (now - fx.last) / 1000)) : 0
  if (fx) fx.last = now
  const isUser = (n: NoteEvent) => s.userHands === 'both' || s.userHands === n.hand
  const autoAlpha = s.autoAlpha ?? pal.autoAlpha

  // Beat pulse (kiai): strong on the bar, gentle on each beat, decays within the beat.
  let pulse = 0
  if (s.live && !calm) {
    const f = s.beat - Math.floor(s.beat)
    const bar = ((Math.floor(s.beat) % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar === 0
    pulse = Math.exp(-f * 6) * (bar ? 1 : 0.45)
  }

  // ── Stage: cached background, then the beat-pulse floor glow.
  const stage = stageLayer(ctx, dpr, W, hitY, layout, s.pads ? geo.padX0 : null, geo.padW)
  ctx.drawImage(stage.canvas!, 0, 0, W, hitY)
  ctx.globalAlpha = 0.35 + 0.65 * pulse
  ctx.fillStyle = stage.floor!
  ctx.fillRect(0, hitY * 0.55, W, hitY * 0.45)
  ctx.globalAlpha = 1

  // Parallax dust on the dark stage, drifting at a third of the note speed.
  if (!calm && pal.dust) {
    ctx.fillStyle = pal.dust
    const shift = s.beat * pxPerBeat * 0.33
    for (let i = 0; i < DUST.length; i += 2) {
      const y = (((DUST[i + 1] * hitY + shift) % hitY) + hitY) % hitY
      const sz = i % 6 === 0 ? 2 : 1
      ctx.fillRect(DUST[i] * W, y, sz, sz)
    }
  }

  if (s.loop) {
    const y1 = yOf(s.loop[1]), y0 = yOf(s.loop[0])
    ctx.fillStyle = pal.loop
    ctx.fillRect(0, Math.max(0, y1), W, Math.min(hitY, y0) - Math.max(0, y1))
  }

  // Beat and bar lines
  const first = Math.floor(s.beat - 1), last = Math.ceil(s.beat + s.beatsVisible)
  ctx.font = `600 11px ${FONT}`
  for (let b = first; b <= last; b++) {
    const y = yOf(b)
    if (y < 0 || y > hitY) continue
    const isBar = ((b % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar === 0
    ctx.fillStyle = isBar ? pal.bar : pal.beat
    ctx.fillRect(0, Math.round(y), W, 1)
    if (isBar && b >= 0) { ctx.fillStyle = pal.barText; ctx.fillText(String(b / s.beatsPerBar + 1), 8, y - 5) }
  }

  // ── Falling notes: only the visible ones, batched by colour and state, one fill per batch.
  const vis = visibleNotes(s.notes, s.beat - 40 / pxPerBeat, s.beat + s.beatsVisible + 0.1, scratch)
  buckets.clear()
  const heads = new Path2D() // the bright attack end of each of the player's notes
  const edges = new Path2D() // a thin highlight down the left edge
  const okRims = new Path2D(), lateRims = new Path2D(), missRims = new Path2D()
  const glow: Partial<Record<'R' | 'L', Path2D>> = {}
  const approach = pxPerBeat * 1.25 // the player's next notes glow this far above the hit line
  const labelled: number[] = []
  const sung: { text: string; x: number; y: number }[] = [] // chant syllables, drawn beside their notes
  for (const i of vis) {
    const n = s.notes[i]
    const drum = n.drum !== undefined
    const k = drum ? (s.pads ? { x: laneX(n.drum!), w: geo.padW, black: false } : undefined) : layout.get(n.pitch)
    if (!k) continue
    const yBot = yOf(n.start)
    const pad = k.black ? 1.5 : 3
    const x = k.x + pad, w = k.w - pad * 2
    // A drum hit has no length: a short block keeps the rhythm readable.
    const top = Math.max(drum ? yBot - Math.min(14, pxPerBeat * 0.25) : yOf(n.start + n.dur), -10), bot = Math.min(yBot, hitY + 40) - 1
    if (bot - top < 1) continue
    const r = Math.min(w * 0.34, 8, (bot - top) / 2)
    const g = s.grades?.get(n)
    const user = isUser(n)
    let b: Bucket
    if (g === 'missed') b = bucket('miss', pal.miss, pal.miss, 0.9, pal.miss)
    else if (drum) b = bucket(`d${n.drum}${user ? 'u' : 'a'}`, '', '', user ? 1 : autoAlpha, currentDrums()[n.drum!].color)
    else { const [c1, c2] = pal.hands[n.hand]; b = bucket(n.hand + (user ? 'u' : 'a'), c1, c2, user ? 1 : autoAlpha) }
    b.path.roundRect(x, top, w, bot - top, r)
    if (g === 'missed') missRims.roundRect(x, top, w, bot - top, r)
    else if (g) (g === 'early' || g === 'late' ? lateRims : okRims).roundRect(x - 1, top - 1, w + 2, bot - top + 2, r + 1)
    if (user && !g) {
      if (bot - top > 8) heads.roundRect(x, bot - Math.min(7, (bot - top) * 0.3), w, Math.min(7, (bot - top) * 0.3), [0, 0, r, r])
      edges.rect(x + Math.max(2, r * 0.5), top + r, 1.5, Math.max(0, bot - top - r * 2))
      if (!drum && hitY - yBot < approach) (glow[n.hand] ??= new Path2D()).roundRect(x, top, w, bot - top, r)
    }
    if ((drum ? w > 16 : s.labels !== 'none' && bot - top > 14 && w > 12) && g !== 'missed') labelled.push(i)
    if (n.text) sung.push({ text: n.text, x: x + w + 5, y: bot - 5 })
  }
  // Glow under the player's approaching notes: one blurred fill per hand.
  if (!calm) for (const h of ['R', 'L'] as const) {
    const p = glow[h]; if (!p) continue
    ctx.shadowColor = pal.hands[h][0]; ctx.shadowBlur = 18
    ctx.globalAlpha = 0.55; ctx.fillStyle = pal.hands[h][0]
    ctx.fill(p)
  }
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
  for (const b of buckets.values()) {
    ctx.globalAlpha = b.alpha
    ctx.fillStyle = b.solid ?? noteFill(ctx, hitY, b.c1, b.c2)
    ctx.fill(b.path)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fill(heads)
  ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.fill(edges)
  ctx.lineWidth = 2
  ctx.strokeStyle = pal.ok; ctx.stroke(okRims)
  ctx.strokeStyle = pal.warn; ctx.stroke(lateRims)
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8
  ctx.strokeStyle = pal.bad; ctx.stroke(missRims)
  ctx.globalAlpha = 1

  // Labels: one font per size, set only when it changes.
  if (labelled.length) {
    ctx.textAlign = 'center'
    let font = ''
    for (const i of labelled) {
      const n = s.notes[i]
      const drum = n.drum !== undefined
      const k = drum ? { x: laneX(n.drum!), w: geo.padW } : layout.get(n.pitch)!
      const pad = drum || !isBlack(n.pitch) ? 3 : 1.5, w = k.w - pad * 2, x = k.x + pad
      const top = Math.max(drum ? -1e9 : yOf(n.start + n.dur), -10), bot = Math.min(yOf(n.start), hitY + 40) - 1
      const f = labelFont(Math.round(Math.min(drum ? 11 : 12, w * (drum ? 0.4 : 0.45))))
      if (f !== font) { ctx.font = f; font = f }
      ctx.fillStyle = drum ? 'rgba(10,12,20,0.8)' : pal.label
      if (drum) { ctx.fillText(currentDrums()[n.drum!].short, x + w / 2, bot - 3); continue }
      ctx.fillText(s.labels === 'octave' ? noteNameOct(n.pitch) : noteName(n.pitch), x + w / 2, bot - 6)
      if (n.finger && isUser(n) && bot - top > 30) ctx.fillText(String(n.finger), x + w / 2, bot - 20)
    }
    ctx.textAlign = 'left'
  }

  // Chant words: shown even with note labels off, since they are what you sing.
  if (sung.length) {
    ctx.font = labelFont(14)
    ctx.fillStyle = pal.milestone
    for (const t of sung) ctx.fillText(t.text, t.x, t.y)
  }

  // Free-play trails rising from the keys, batched in two colours.
  if (s.trails?.length) {
    const tw = new Path2D(), tb = new Path2D(), tx = new Path2D()
    for (const t of s.trails) {
      const k = layout.get(t.pitch); if (!k) continue
      const end = t.off ?? now
      const yb = hitY - (now - end) * 0.12, yt = Math.max(0, hitY - (now - t.on) * 0.12)
      if (yb < 0) continue
      ;(t.ok === false ? tx : k.black ? tb : tw).roundRect(k.x + 3, yt, k.w - 6, Math.max(2, yb - yt), Math.min(6, (k.w - 6) / 2))
    }
    ctx.globalAlpha = 0.85
    ctx.fillStyle = noteFill(ctx, hitY, pal.hands.R[0], pal.hands.R[1]); ctx.fill(tw)
    ctx.fillStyle = noteFill(ctx, hitY, pal.hands.L[0], pal.hands.L[1]); ctx.fill(tb)
    ctx.fillStyle = pal.bad; ctx.fill(tx)
    ctx.globalAlpha = 1
  }

  // Held keys: a soft light column rising from the key, so you see what you are pressing without hiding notes.
  if (pal.additive) ctx.globalCompositeOperation = 'lighter'
  for (const p of s.held.keys()) {
    const k = layout.get(p); if (!k) continue
    const f = s.flashes?.get(p)
    const color = f && f.until > now && !f.ok ? pal.bad : f && f.until > now ? pal.ok : '#6366f1'
    ctx.fillStyle = glowFor(ctx, color, hitY)
    ctx.fillRect(k.x + 1, hitY - 110, k.w - 2, 110)
  }
  ctx.globalCompositeOperation = 'source-over'

  // Hit line: a crisp line with a soft halo that breathes with the beat (amber while Wait mode waits).
  const lineColor = s.waiting ? pal.lineWait : pal.line
  ctx.fillStyle = glowFor(ctx, s.waiting ? '#f59e0b' : '#6366f1', hitY)
  ctx.globalAlpha = 0.1 + 0.32 * pulse + (s.waiting ? 0.3 : 0)
  ctx.fillRect(0, hitY - 110, W, 110) // the whole gradient, so the glow fades out instead of ending in an edge
  ctx.globalAlpha = 1
  ctx.fillStyle = lineColor
  ctx.fillRect(0, hitY - 2, W, 2)

  // ── Keyboard: the resting keys come from the cached layer; only keys that are pressed, sounding,
  // flashing, pending or still springing back are drawn on top.
  const sounding = soundingKeys(s, vis)
  const pending = s.pending ?? []
  const ease = (p: number, down: boolean) => {
    if (!fx) return down ? 1 : 0
    const d = fx.depth[p] + ((down ? 1 : 0) - fx.depth[p]) * (1 - Math.exp(-dt / (down ? 0.025 : 0.06)))
    fx.depth[p] = d < 0.001 ? 0 : d
    return fx.depth[p]
  }
  const dots = s.highlightPcs?.join(',') ?? ''
  ctx.drawImage(keyboardLayer(dpr, W, geo.kbW, kbH, s.labels, dots), 0, hitY, W, kbH)
  const hl = s.highlightPcs
  // Each key's state is worked out once per frame (easing advances the press depth, so it must run once per key).
  keyFills.clear()
  for (const [p, k] of layout) {
    const down = s.held.has(p)
    const d = ease(p, down || sounding.has(p))
    const f = s.flashes?.get(p)
    const fill = down ? (f && f.until > now && !f.ok ? pal.bad : f && f.until > now ? pal.ok : k.black ? pal.heldKeyBlack : pal.heldKey)
      : sounding.has(p) ? pal.hands[sounding.get(p)!][k.black ? 1 : 0]
      : d > 0 ? (k.black ? pal.black : pal.white) : null
    if (fill) keyFills.set(p, fill)
  }
  for (const [p, k] of whites) {
    const fill = keyFills.get(p)
    if (fill) drawKey(ctx, p, k, hitY, kbH, fill, s.labels, !!hl?.includes(p % 12) && !s.held.has(p), fx?.depth[p] ?? 0)
  }
  for (const [p, k] of blacks) {
    // A redrawn white key paints over its black neighbours' edges, so those are redrawn too.
    const fill = keyFills.get(p) ?? (keyFills.has(p - 1) || keyFills.has(p + 1) ? pal.black : null)
    if (fill) drawKey(ctx, p, k, hitY, kbH, fill, s.labels, !!hl?.includes(p % 12) && !s.held.has(p), fx?.depth[p] ?? 0)
  }
  if (pending.length || s.fingers?.length) {
    const blink = 0.5 + 0.5 * Math.sin(now / 160)
    for (const p of pending) {
      const k = layout.get(p); if (!k) continue
      const h = k.black ? kbH * 0.62 : kbH
      ctx.strokeStyle = `rgba(245,158,11,${0.55 + 0.45 * blink})`
      ctx.lineWidth = 3
      roundRect(ctx, k.x + 2, hitY + 2, k.w - 4, h - 4, 5)
      ctx.stroke()
    }
    for (const spot of s.fingers ?? []) {
      const k = layout.get(spot.pitch); if (!k) continue
      // On white keys the circle sits below the black keys so nothing covers it.
      const h = k.black ? kbH * 0.62 : kbH
      const cy = hitY + h * (k.black ? 0.55 : 0.74), rad = Math.min(11, k.w * 0.38)
      ctx.fillStyle = pal.hands[spot.hand][1]
      ctx.beginPath(); ctx.arc(k.x + k.w / 2, cy, rad, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${Math.round(rad * 1.2)}px ${FONT}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(spot.finger), k.x + k.w / 2, cy + 0.5)
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    }
  }

  // Drum pads: rubbery squares that sink and light up when struck.
  if (s.pads) {
    ctx.fillStyle = pal.padBed
    ctx.fillRect(geo.padX0 - W * 0.02, hitY, W - geo.padX0 + W * 0.02, kbH)
    for (let dIdx = 0; dIdx < 8; dIdx++) {
      const x = laneX(dIdx), w = geo.padW
      const f = s.flashes?.get(PAD_PITCH + dIdx)
      const lit = (s.padHits?.[dIdx] ?? 0) > now || (!!f && f.until > now)
      const d = ease(PAD_PITCH + dIdx, lit)
      const inset = 3 + d * 2
      const px = x + inset, py = geo.padTop + d * 2, pw = w - inset * 2, ph = geo.padSize - d * 3
      const color = f && f.until > now && !f.ok ? pal.bad : currentDrums()[dIdx].color
      if (lit) { ctx.globalAlpha = 0.35; ctx.fillStyle = color; roundRect(ctx, px - 4, py - 4, pw + 8, ph + 8, 12); ctx.fill(); ctx.globalAlpha = 1 }
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      roundRect(ctx, px, py + 3, pw, ph, 9); ctx.fill()
      ctx.fillStyle = lit ? color : pal.padIdle
      roundRect(ctx, px, py, pw, ph, 9); ctx.fill()
      ctx.fillStyle = color
      ctx.fillRect(px + 8, py + 4, pw - 16, 2) // the pad's colour as a small stripe, also when idle
      if (pending.includes(PAD_PITCH + dIdx)) {
        ctx.strokeStyle = 'rgba(245,158,11,0.9)'; ctx.lineWidth = 3
        roundRect(ctx, px, py, pw, ph, 9); ctx.stroke()
      }
      ctx.fillStyle = lit ? '#0b0d14' : pal.padText
      ctx.font = `600 ${Math.min(10, w * 0.22)}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(String(dIdx + 1), x + w / 2, py + 18)
      ctx.fillText(w > 56 ? currentDrums()[dIdx].name : currentDrums()[dIdx].short, x + w / 2, py + ph - 8)
      ctx.textAlign = 'left'
    }
  }
  // Shadow from the hit-line rail onto the keys
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.fillRect(0, hitY, W, 3)

  if (fx) drawEffects(ctx, W, hitY, now, fx, calm, (p) => {
    if (p >= PAD_PITCH) return s.pads ? geo.padX0 + (p - PAD_PITCH + 0.5) * geo.padW : -1
    const k = layout.get(p)
    return k ? k.x + k.w / 2 : -1
  })
}

const keyFills = new Map<number, string>()

/** Keys the app itself is playing right now (the other hand, Watch mode): lit on the keyboard. */
const soundingMap = new Map<number, 'L' | 'R'>()
function soundingKeys(s: Scene, vis: number[]) {
  soundingMap.clear()
  for (const i of vis) {
    const n = s.notes[i]
    if (n.drum === undefined && s.beat >= n.start && s.beat < n.start + n.dur && !(s.userHands === 'both' || s.userHands === n.hand)) soundingMap.set(n.pitch, n.hand)
  }
  return soundingMap
}

function drawEffects(ctx: CanvasRenderingContext2D, W: number, hitY: number, now: number, fx: Effects, calm: boolean, cx: (p: number) => number) {
  // Shockwave rings at the key.
  if (pal.additive) ctx.globalCompositeOperation = 'lighter'
  for (const r of fx.rings) {
    const t = (now - r.t0) / 320
    if (t < 0 || t >= 1) continue
    const x = cx(r.pitch); if (x < 0) continue
    ctx.globalAlpha = 0.85 * (1 - t)
    ctx.strokeStyle = r.color
    ctx.lineWidth = 3 * (1 - t) + 0.5
    ctx.beginPath(); ctx.arc(x, hitY, 8 + easeOut(t) * 34, Math.PI, Math.PI * 2); ctx.stroke()
  }
  // Sparks: a few particles in the note colour, falling under gravity.
  if (!calm) for (const sp of fx.sparks) {
    const t = (now - sp.t0) / 450
    if (t < 0 || t >= 1) continue
    const x = cx(sp.pitch); if (x < 0) continue
    const sec = t * 0.45
    ctx.globalAlpha = 1 - t
    ctx.fillStyle = sp.color
    const z = sp.size * (1 - t * 0.6)
    ctx.fillRect(x + sp.vx * sec - z / 2, hitY + sp.vy * sec + 700 * sec * sec - z / 2, z, z)
  }
  ctx.globalCompositeOperation = 'source-over'

  // Judgment pops: scale in, float up, fade.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `800 13px ${DISPLAY}`
  for (const p of fx.pops) {
    const t = (now - p.t0) / 420
    if (t < 0 || t >= 1) continue
    const x = cx(p.pitch); if (x < 0) continue
    const k = calm ? 1 : 0.55 + 0.45 * backOut(clamp01(t / 0.18))
    const y = hitY - 26 - (calm ? 0 : 22 * easeOut(t))
    ctx.globalAlpha = 0.95 * (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45)
    ctx.save()
    ctx.translate(x, y); ctx.scale(k, k)
    ctx.lineWidth = 3; ctx.strokeStyle = pal.judgeHalo; ctx.lineJoin = 'round'
    ctx.strokeText(JUDGE_TEXT[p.kind], 0, 0)
    ctx.fillStyle = judgeColor(p.kind)
    ctx.fillText(JUDGE_TEXT[p.kind], 0, 0)
    ctx.restore()
  }
  // Combo milestone: a big, faint number in the middle of the lane area.
  const mt = (now - fx.mile.t0) / 900
  if (mt >= 0 && mt < 1) {
    const k = calm ? 1 : 0.85 + 0.25 * easeOut(mt)
    ctx.globalAlpha = 0.45 * (mt < 0.2 ? mt / 0.2 : 1 - (mt - 0.2) / 0.8)
    ctx.save()
    ctx.translate(W / 2, hitY * 0.42); ctx.scale(k, k)
    ctx.font = `800 64px ${DISPLAY}`
    ctx.fillStyle = pal.milestone
    ctx.fillText(`${fx.mile.n} COMBO`, 0, 0)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
}
