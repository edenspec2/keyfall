import type { NoteEvent } from '../music/types'
import { DRUMS, PAD_PITCH } from '../music/drums'
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
}

/** Where the keyboard, the pad lanes and the hit line sit. Shared by drawing and by mouse hit-testing. */
export function sceneGeometry(W: number, H: number, pads?: boolean, padShare = 0.3) {
  const kbH = Math.min(150, Math.max(90, H * 0.24))
  const padX0 = W * (1 - padShare), padW = (W - padX0) / 8
  const kbW = pads ? padX0 - W * 0.02 : W
  return { kbH, hitY: H - kbH, kbW, padX0, padW, padTop: H - kbH + 10, padSize: kbH - 20 }
}

export const COLORS = {
  R: ['#5ec8ff', '#2f8cff'],
  L: ['#ffb35e', '#ff6a8a'],
  ok: '#5df2a0',
  bad: '#ff5470',
  bg: '#08090e',
}

const FONT = '-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const DISPLAY = '-apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'

/** Judgment text and colour; 'hit' is Wait mode (no timing), 'wrong' a key that wasn't asked for. */
export type Judgment = Grade | 'wrong'
export const JUDGE: Record<Judgment, [string, string]> = {
  perfect: ['PERFECT', '#7cf0ff'],
  good: ['GOOD', '#5df2a0'],
  early: ['EARLY', '#ffe066'],
  late: ['LATE', '#ffb35e'],
  missed: ['MISS', '#ff5470'],
  hit: ['✓', '#5df2a0'],
  wrong: ['✗', '#ff5470'],
}

const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

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

  judge(pitch: number, kind: Judgment, now: number, color = JUDGE[kind][1]) {
    const p = this.pops[this.pi++ % this.pops.length]
    p.pitch = pitch; p.t0 = now; p.kind = kind
    if (kind === 'missed' || kind === 'wrong') return
    const r = this.rings[this.ri++ % this.rings.length]
    r.pitch = pitch; r.t0 = now; r.color = color
    if (reduceMotion?.matches) return
    const n = kind === 'perfect' ? 9 : 6
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

/** Key geometry for a pitch range; white keys equal width, black keys centred on the gap. */
export function keyLayout(lo: number, hi: number, width: number) {
  const whites: number[] = []
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p)
  const ww = width / whites.length
  const x = new Map<number, { x: number; w: number; black: boolean }>()
  whites.forEach((p, i) => x.set(p, { x: i * ww, w: ww, black: false }))
  for (let p = lo; p <= hi; p++) if (isBlack(p)) {
    const left = x.get(p - 1)
    if (left) x.set(p, { x: left.x + ww * 0.68, w: ww * 0.62, black: true })
  }
  return x
}

/** Display range: always whole octaves C..C covering the requested range. */
export function displayRange(lo: number, hi: number): [number, number] {
  return [Math.floor(lo / 12) * 12, Math.max(Math.ceil(hi / 12) * 12, Math.floor(lo / 12) * 12 + 12)]
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t)
const backOut = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

// Gradients depend only on the canvas size, so they are rebuilt when it changes, not every frame.
const cache = { key: '', bg: null as OffscreenCanvas | null, bgCtx: null as OffscreenCanvasRenderingContext2D | null, blob: null as CanvasGradient | null, blob2: null as CanvasGradient | null, white: null as CanvasGradient | null, black: null as CanvasGradient | null, floor: null as CanvasGradient | null, glow: new Map<string, CanvasGradient>() }
const BG_SCALE = 8
// Parallax dust: fixed pseudo-random positions in [0,1).
const DUST = Float32Array.from({ length: 96 }, (_, i) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1)

function gradients(ctx: CanvasRenderingContext2D, W: number, H: number, hitY: number, kbH: number) {
  const key = `${W}x${H}`
  if (cache.key === key) return cache
  cache.key = key
  // The ambient background is soft, so it is painted at 1/BG_SCALE resolution and scaled up: full-size gradient
  // fills cost several ms per frame on software-rendered canvases.
  cache.bg = new OffscreenCanvas(Math.max(1, Math.ceil(W / BG_SCALE)), Math.max(1, Math.ceil(hitY / BG_SCALE)))
  cache.bgCtx = cache.bg.getContext('2d', { alpha: false })!
  const b = cache.bgCtx, bw = cache.bg.width, bh = cache.bg.height
  const R = Math.max(bw, bh) * 0.7
  cache.blob = b.createRadialGradient(0, 0, 0, 0, 0, R)
  cache.blob.addColorStop(0, 'rgba(110,120,255,0.16)'); cache.blob.addColorStop(1, 'rgba(110,120,255,0)')
  cache.blob2 = b.createRadialGradient(0, 0, 0, 0, 0, R * 0.8)
  cache.blob2.addColorStop(0, 'rgba(94,200,255,0.10)'); cache.blob2.addColorStop(1, 'rgba(94,200,255,0)')
  cache.floor = b.createLinearGradient(0, bh * 0.55, 0, bh)
  cache.floor.addColorStop(0, 'rgba(124,140,255,0)'); cache.floor.addColorStop(1, 'rgba(124,140,255,0.16)')
  cache.white = ctx.createLinearGradient(0, hitY, 0, hitY + kbH)
  cache.white.addColorStop(0, 'rgba(0,0,0,0.22)'); cache.white.addColorStop(0.08, 'rgba(0,0,0,0.04)')
  cache.white.addColorStop(0.85, 'rgba(0,0,0,0)'); cache.white.addColorStop(1, 'rgba(0,0,0,0.10)')
  cache.black = ctx.createLinearGradient(0, hitY, 0, hitY + kbH * 0.62)
  cache.black.addColorStop(0, 'rgba(0,0,0,0.35)'); cache.black.addColorStop(0.15, 'rgba(255,255,255,0.10)')
  cache.black.addColorStop(0.7, 'rgba(255,255,255,0.02)'); cache.black.addColorStop(1, 'rgba(255,255,255,0.16)')
  cache.glow.clear()
  return cache
}
function glowFor(ctx: CanvasRenderingContext2D, color: string, hitY: number) {
  let g = cache.glow.get(color)
  if (!g) {
    g = ctx.createLinearGradient(0, hitY - 90, 0, hitY)
    g.addColorStop(0, color + '00'); g.addColorStop(1, color + '66')
    cache.glow.set(color, g)
  }
  return g
}

export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, s: Scene, now: number, fx?: Effects) {
  const [lo, hi] = s.range
  const geo = sceneGeometry(W, H, s.pads, s.padShare)
  const layout = keyLayout(lo, hi, geo.kbW)
  const { kbH, hitY } = geo
  const lane = (d: number) => ({ x: geo.padX0 + d * geo.padW, w: geo.padW, black: false })
  const pxPerBeat = hitY / s.beatsVisible
  const yOf = (beat: number) => hitY - (beat - s.beat) * pxPerBeat
  const calm = !!reduceMotion?.matches
  const gr = gradients(ctx, W, H, hitY, kbH)
  const dt = fx ? Math.min(0.05, Math.max(0, (now - fx.last) / 1000)) : 0
  if (fx) fx.last = now

  // Beat pulse (kiai): strong on the bar, gentle on each beat, decays within the beat.
  let pulse = 0
  if (s.live && !calm) {
    const f = s.beat - Math.floor(s.beat)
    const bar = ((Math.floor(s.beat) % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar === 0
    pulse = Math.exp(-f * 6) * (bar ? 1 : 0.45)
  }

  // Slowly drifting colour fields behind the notes (low contrast; they breathe with the beat).
  // Gradients are built around (0,0) and moved with translate, so they are reused every frame.
  const t = calm ? 0 : now / 1000
  const b = gr.bgCtx!, bw = gr.bg!.width, bh = gr.bg!.height
  b.fillStyle = COLORS.bg
  b.fillRect(0, 0, bw, bh)
  b.globalAlpha = 0.75 + 0.5 * pulse
  let bx = bw * (0.3 + 0.12 * Math.sin(t / 9)), by = bh * (0.35 + 0.12 * Math.cos(t / 11))
  b.fillStyle = gr.blob!
  b.translate(bx, by); b.fillRect(-bx, -by, bw, bh); b.translate(-bx, -by)
  bx = bw * (0.75 + 0.1 * Math.cos(t / 13)); by = bh * (0.6 + 0.1 * Math.sin(t / 7))
  b.fillStyle = gr.blob2!
  b.translate(bx, by); b.fillRect(-bx, -by, bw, bh); b.translate(-bx, -by)
  // Floor glow above the hit line, pulsing on the beat.
  b.globalAlpha = 0.35 + 0.65 * pulse
  b.fillStyle = gr.floor!
  b.fillRect(0, bh * 0.55, bw, bh * 0.45)
  b.globalAlpha = 1
  ctx.drawImage(gr.bg!, 0, 0, bw * BG_SCALE, bh * BG_SCALE)

  // Parallax dust drifting at a third of the note speed.
  if (!calm) {
    ctx.fillStyle = 'rgba(200,210,255,0.16)'
    const shift = s.beat * pxPerBeat * 0.33
    for (let i = 0; i < DUST.length; i += 2) {
      const y = (((DUST[i + 1] * hitY + shift) % hitY) + hitY) % hitY
      const sz = i % 6 === 0 ? 2 : 1
      ctx.fillRect(DUST[i] * W, y, sz, sz)
    }
  }

  // Lanes for black keys, subtle.
  ctx.fillStyle = 'rgba(255,255,255,0.022)'
  for (const k of layout.values()) if (k.black) ctx.fillRect(k.x, 0, k.w, hitY)
  // C lines
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  for (const [p, k] of layout) if (p % 12 === 0) ctx.fillRect(k.x, 0, 1, hitY)
  if (s.pads) for (let d = 0; d <= 8; d++) ctx.fillRect(lane(d).x, 0, 1, hitY)

  // Loop region
  if (s.loop) {
    const y1 = yOf(s.loop[1]), y0 = yOf(s.loop[0])
    ctx.fillStyle = 'rgba(160,120,255,0.07)'
    ctx.fillRect(0, Math.max(0, y1), W, Math.min(hitY, y0) - Math.max(0, y1))
  }

  // Beat and bar lines
  const first = Math.floor(s.beat - 1), last = Math.ceil(s.beat + s.beatsVisible)
  ctx.font = `500 11px ${FONT}`
  for (let b = first; b <= last; b++) {
    const y = yOf(b)
    if (y < 0 || y > hitY) continue
    const isBar = ((b % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar === 0
    ctx.fillStyle = isBar ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.045)'
    ctx.fillRect(0, y, W, 1)
    if (isBar && b >= 0) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(String(b / s.beatsPerBar + 1), 6, y - 4) }
  }

  // Falling notes
  const r = Math.max(3, (W / 50) * 0.25)
  const approach = pxPerBeat * 1.5 // notes start to glow this far above the hit line
  for (const n of s.notes) {
    const yTop = yOf(n.start + n.dur), yBot = yOf(n.start)
    if (yBot < -10 || yTop > hitY + 40) continue
    const drum = n.drum !== undefined
    const k = drum ? (s.pads ? lane(n.drum!) : undefined) : layout.get(n.pitch)
    if (!k) continue
    const g = s.grades?.get(n)
    const isUser = s.userHands === 'both' || s.userHands === n.hand
    const [c1, c2] = drum ? [DRUMS[n.drum!].color, DRUMS[n.drum!].color] : COLORS[n.hand]
    const pad = k.black ? 1 : 3
    const x = k.x + pad, w = k.w - pad * 2
    // A drum hit has no length: draw it as a short block so the rhythm is easy to read.
    const top = Math.max(drum ? yBot - Math.min(14, pxPerBeat * 0.25) : yTop, -10), bot = Math.min(yBot, hitY + 40) - 1
    if (bot - top < 1) continue
    // Approach: the player's ungraded notes brighten and glow as they near the hit line.
    const near = isUser && !g ? clamp01(1 - (hitY - yBot) / approach) : 0
    if (near > 0) {
      ctx.globalAlpha = 0.28 * near
      ctx.fillStyle = c1
      roundRect(ctx, x - 4 * near, top - 4 * near, w + 8 * near, bot - top + 8 * near, r + 4)
      ctx.fill()
    }
    const grad = ctx.createLinearGradient(0, top, 0, bot)
    grad.addColorStop(0, c1); grad.addColorStop(1, c2)
    ctx.globalAlpha = g === 'missed' ? 0.3 : isUser ? 1 : 0.45
    ctx.fillStyle = grad
    roundRect(ctx, x, top, w, bot - top, r)
    ctx.fill()
    if (near > 0) {
      ctx.globalAlpha = 0.22 * near
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
    // Top sheen
    ctx.globalAlpha = isUser ? 0.35 : 0.15
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x + r * 0.6, top + 1, Math.max(0, w - r * 1.2), 1)
    if (g && g !== 'missed') {
      ctx.globalAlpha = 1
      roundRect(ctx, x, top, w, bot - top, r)
      ctx.strokeStyle = g === 'early' || g === 'late' ? '#ffe066' : COLORS.ok
      ctx.lineWidth = 2
      ctx.stroke()
    } else if (g === 'missed') {
      ctx.globalAlpha = 0.9; roundRect(ctx, x, top, w, bot - top, r); ctx.strokeStyle = COLORS.bad; ctx.lineWidth = 1.5; ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (drum && w > 16) {
      ctx.fillStyle = 'rgba(10,12,20,0.85)'
      ctx.font = `700 ${Math.min(11, w * 0.4)}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(DRUMS[n.drum!].short, x + w / 2, bot - 3)
      ctx.textAlign = 'left'
    } else if (!drum && s.labels !== 'none' && bot - top > 14 && w > 12) {
      ctx.fillStyle = 'rgba(10,12,20,0.85)'
      ctx.font = `650 ${Math.min(12, w * 0.45)}px ${FONT}`
      ctx.textAlign = 'center'
      const label = s.labels === 'octave' ? noteNameOct(n.pitch) : noteName(n.pitch)
      ctx.fillText(label, x + w / 2, bot - 5)
      if (n.finger && isUser && bot - top > 30) ctx.fillText(String(n.finger), x + w / 2, bot - 19)
      ctx.textAlign = 'left'
    }
  }

  // Free-play trails rising from the keys
  if (s.trails) {
    for (const t of s.trails) {
      const k = layout.get(t.pitch); if (!k) continue
      const end = t.off ?? now
      const yb = hitY - (now - end) * 0.12, yt = hitY - (now - t.on) * 0.12
      if (yb < 0) continue
      ctx.globalAlpha = Math.max(0.15, Math.min(1, yb / hitY))
      ctx.fillStyle = t.ok === false ? COLORS.bad : k.black ? COLORS.L[1] : COLORS.R[0]
      roundRect(ctx, k.x + 3, Math.max(0, yt), k.w - 6, Math.max(2, yb - Math.max(0, yt)), r)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // Held keys: a soft light column rising from the key (additive, so it never hides a note).
  ctx.globalCompositeOperation = 'lighter'
  for (const p of s.held.keys()) {
    const k = layout.get(p); if (!k) continue
    const f = s.flashes?.get(p)
    const color = f && f.until > now && !f.ok ? COLORS.bad : f && f.until > now ? COLORS.ok : '#7c8cff'
    ctx.fillStyle = glowFor(ctx, color, hitY)
    ctx.fillRect(k.x + 1, hitY - 90, k.w - 2, 90)
  }
  ctx.globalCompositeOperation = 'source-over'

  // Hit line
  const lineGrad = ctx.createLinearGradient(0, hitY - 10, 0, hitY)
  lineGrad.addColorStop(0, 'rgba(120,180,255,0)'); lineGrad.addColorStop(1, s.waiting ? 'rgba(255,224,102,0.6)' : `rgba(130,170,255,${0.4 + 0.4 * pulse})`)
  ctx.fillStyle = lineGrad
  ctx.fillRect(0, hitY - 10, W, 10)
  ctx.fillStyle = s.waiting ? 'rgba(255,224,102,0.8)' : `rgba(170,200,255,${0.45 + 0.4 * pulse})`
  ctx.fillRect(0, hitY - 1, W, 1)

  // Keyboard: eased press depth gives each key a short, physical travel.
  const sounding = new Map<number, 'L' | 'R'>()
  // Light only notes the app plays itself; the player's own notes must be found, not shown.
  for (const n of s.notes) if (s.beat >= n.start && s.beat < n.start + n.dur && !(s.userHands === 'both' || s.userHands === n.hand)) sounding.set(n.pitch, n.hand)
  const pending = new Set(s.pending ?? [])
  const blink = 0.5 + 0.5 * Math.sin(now / 160)
  const ease = (p: number, down: boolean) => {
    if (!fx) return down ? 1 : 0
    const d = fx.depth[p] + ((down ? 1 : 0) - fx.depth[p]) * (1 - Math.exp(-dt / (down ? 0.025 : 0.06)))
    fx.depth[p] = d
    return d
  }
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, hitY, geo.kbW, kbH)
  for (const black of [false, true]) {
    for (const [p, k] of layout) {
      if (k.black !== black) continue
      const down = s.held.has(p)
      const d = ease(p, down || sounding.has(p))
      const h = black ? kbH * 0.62 : kbH
      let fill = black ? '#191b24' : '#eceef4'
      const f = s.flashes?.get(p)
      if (down) fill = f && f.until > now && !f.ok ? COLORS.bad : f && f.until > now ? COLORS.ok : black ? '#6c7cff' : '#a9b6ff'
      else if (sounding.has(p)) fill = COLORS[sounding.get(p)!][black ? 1 : 0]
      const kx = k.x + (black ? 0 : 1), kw = k.w - (black ? 0 : 2)
      const lip = black ? 7 - 4 * d : 6 - 4 * d // the front edge shrinks as the key goes down
      // Lip (front face of the key)
      ctx.fillStyle = black ? '#08090d' : '#a7abb8'
      roundRect(ctx, kx, hitY, kw, h, black ? 3 : 5)
      ctx.fill()
      // Top face
      ctx.fillStyle = fill
      roundRect(ctx, kx, hitY + d * 1.5, kw, h - lip - d * 1.5, black ? 3 : 5)
      ctx.fill()
      ctx.fillStyle = black ? gr.black! : gr.white!
      ctx.fill()
      if (black) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(kx + 2, hitY + h - lip - 1, kw - 4, 1) }
      if (s.highlightPcs?.includes(p % 12) && !down) {
        ctx.fillStyle = black ? 'rgba(160,140,255,0.85)' : 'rgba(120,100,255,0.6)'
        ctx.beginPath(); ctx.arc(k.x + k.w / 2, hitY + h - (black ? 14 : 30), black ? 3.5 : 5, 0, Math.PI * 2); ctx.fill()
      }
      if (pending.has(p)) {
        ctx.strokeStyle = `rgba(255,224,102,${0.5 + 0.5 * blink})`
        ctx.lineWidth = 3
        roundRect(ctx, k.x + 2, hitY + 2, k.w - 4, h - 4, 4)
        ctx.stroke()
      }
      const spot = s.fingers?.find((x) => x.pitch === p)
      if (spot) {
        // On white keys the circle sits below the black keys so nothing covers it.
        const cy = hitY + h * (black ? 0.55 : 0.74), rad = Math.min(11, k.w * 0.38)
        ctx.fillStyle = COLORS[spot.hand][0]
        ctx.beginPath(); ctx.arc(k.x + k.w / 2, cy, rad, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#0b0d14'
        ctx.font = `700 ${Math.round(rad * 1.2)}px ${FONT}`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(spot.finger), k.x + k.w / 2, cy + 0.5)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
      if (!black && s.labels !== 'none') {
        ctx.fillStyle = p === 60 ? '#2f8cff' : 'rgba(20,22,32,0.45)'
        ctx.font = `${p === 60 ? 700 : 500} ${Math.min(11, k.w * 0.4)}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.fillText(s.labels === 'octave' || p % 12 === 0 ? noteNameOct(p) : noteName(p), k.x + k.w / 2, hitY + h - lip - 6)
        ctx.textAlign = 'left'
      }
    }
  }
  // Drum pads: rubbery squares that sink and light up when struck.
  if (s.pads) {
    ctx.fillStyle = '#0c0d14'
    ctx.fillRect(geo.padX0 - W * 0.02, hitY, W - geo.padX0 + W * 0.02, kbH)
    for (let dIdx = 0; dIdx < 8; dIdx++) {
      const { x, w } = lane(dIdx)
      const f = s.flashes?.get(PAD_PITCH + dIdx)
      const lit = (s.padHits?.[dIdx] ?? 0) > now || (!!f && f.until > now)
      const d = ease(PAD_PITCH + dIdx, lit)
      const inset = 3 + d * 2
      const px = x + inset, py = geo.padTop + d * 2, pw = w - inset * 2, ph = geo.padSize - d * 3
      const color = f && f.until > now && !f.ok ? COLORS.bad : DRUMS[dIdx].color
      if (lit) { ctx.globalAlpha = 0.35; ctx.fillStyle = color; roundRect(ctx, px - 4, py - 4, pw + 8, ph + 8, 12); ctx.fill(); ctx.globalAlpha = 1 }
      ctx.fillStyle = '#05060a'
      roundRect(ctx, px, py + 3, pw, ph, 9); ctx.fill()
      ctx.fillStyle = lit ? color : '#1e2230'
      roundRect(ctx, px, py, pw, ph, 9); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fillRect(px + 6, py + 1, pw - 12, 1)
      if (pending.has(PAD_PITCH + dIdx)) {
        ctx.strokeStyle = `rgba(255,224,102,${0.5 + 0.5 * blink})`; ctx.lineWidth = 3
        roundRect(ctx, px, py, pw, ph, 9); ctx.stroke()
      }
      ctx.fillStyle = lit ? '#0b0d14' : 'rgba(232,235,244,0.7)'
      ctx.font = `600 ${Math.min(10, w * 0.22)}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(String(dIdx + 1), x + w / 2, py + 14)
      ctx.fillText(w > 56 ? DRUMS[dIdx].name : DRUMS[dIdx].short, x + w / 2, py + ph - 8)
      ctx.textAlign = 'left'
    }
  }
  // Shadow under the hit line onto the keys
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, hitY, W, 3)

  if (fx) drawEffects(ctx, W, hitY, now, fx, calm, (p) => {
    if (p >= PAD_PITCH) return s.pads ? geo.padX0 + (p - PAD_PITCH + 0.5) * geo.padW : -1
    const k = layout.get(p)
    return k ? k.x + k.w / 2 : -1
  })
}

function drawEffects(ctx: CanvasRenderingContext2D, W: number, hitY: number, now: number, fx: Effects, calm: boolean, cx: (p: number) => number) {
  // Shockwave rings at the key (additive).
  ctx.globalCompositeOperation = 'lighter'
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
    const [text, color] = JUDGE[p.kind]
    const k = calm ? 1 : 0.55 + 0.45 * backOut(clamp01(t / 0.18))
    const y = hitY - 22 - (calm ? 0 : 22 * easeOut(t))
    ctx.globalAlpha = 0.92 * (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45)
    ctx.save()
    ctx.translate(x, y); ctx.scale(k, k)
    ctx.fillStyle = 'rgba(5,6,10,0.7)'
    ctx.fillText(text, 0, 1.5)
    ctx.fillStyle = color
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
  // Combo milestone: a big, faint number in the middle of the lane area.
  const mt = (now - fx.mile.t0) / 900
  if (mt >= 0 && mt < 1) {
    const k = calm ? 1 : 0.85 + 0.25 * easeOut(mt)
    ctx.globalAlpha = 0.5 * (mt < 0.2 ? mt / 0.2 : 1 - (mt - 0.2) / 0.8)
    ctx.save()
    ctx.translate(W / 2, hitY * 0.42); ctx.scale(k, k)
    ctx.font = `800 64px ${DISPLAY}`
    ctx.fillStyle = '#c9d2ff'
    ctx.fillText(`${fx.mile.n} COMBO`, 0, 0)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
}
