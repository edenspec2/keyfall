import { useEffect, useRef } from 'react'
import { drawScene, Effects, keyLayout, renderOpts, sceneGeometry, type Scene } from '../render/pianoRenderer'
import { lightEngine } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'

// Phones: at their full pixel density (about 2.75) the canvas has ~7× a PC's pixels to fill every frame.
const lite = renderOpts.lite = lightEngine()
const MAX_DPR = lite ? 1.5 : Infinity

/**
 * Canvas that redraws every animation frame from `scene()`. React renders it once;
 * the frame loop never touches React state. `tick` runs before each draw (session clock, scoring).
 * `fx` holds hit effects pushed by the caller; without one the canvas keeps its own (key travel only).
 */
export function PianoCanvas({ scene, tick, fx }: { scene: () => Scene; tick?: () => void; fx?: Effects }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const ownFx = useRef<Effects>(null)
  const fxRef = useRef(fx)
  fxRef.current = fx ?? (ownFx.current ??= new Effects())
  const sceneRef = useRef(scene)
  const tickRef = useRef(tick)
  sceneRef.current = scene
  tickRef.current = tick

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d', { alpha: false })!
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      tickRef.current?.()
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawScene(ctx, w, h, sceneRef.current(), performance.now(), fxRef.current)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Mouse/touch on the drawn keyboard plays notes (no hardware needed).
  const pointerPitch = (e: React.PointerEvent) => {
    const canvas = ref.current!, r = canvas.getBoundingClientRect()
    const s = sceneRef.current()
    const { kbH, kbW, padX0, padW } = sceneGeometry(r.width, r.height, s.pads, s.padShare)
    const y = e.clientY - r.top, x = e.clientX - r.left
    if (y < r.height - kbH) return null
    if (s.pads && x >= padX0) return { pad: Math.min(7, Math.floor((x - padX0) / padW)) }
    const layout = keyLayout(s.range[0], s.range[1], kbW)
    const inBlack = y < r.height - kbH + kbH * 0.62
    for (const [p, k] of layout) if (k.black === true && inBlack && x >= k.x && x < k.x + k.w) return p
    for (const [p, k] of layout) if (!k.black && x >= k.x && x < k.x + k.w) return p
    return null
  }
  // One entry per finger: a single "last key" leaked the first note of a two-finger tap.
  const down = useRef(new Map<number, number>()) // pointerId → pitch
  const release = (e: React.PointerEvent) => {
    const p = down.current.get(e.pointerId)
    if (p === undefined) return
    down.current.delete(e.pointerId)
    midi.emit({ type: 'off', pitch: p, channel: 1, time: performance.now(), source: 'mouse' })
  }
  // Leaving the screen with fingers down (e.g. lesson ends) must not leave notes hanging.
  useEffect(() => () => {
    for (const p of down.current.values()) midi.emit({ type: 'off', pitch: p, channel: 1, time: performance.now(), source: 'mouse' })
    down.current.clear()
  }, [])

  return (
    <canvas
      ref={ref}
      aria-label="Falling notes and piano keyboard. Click keys to play."
      onPointerDown={(e) => {
        const p = pointerPitch(e)
        if (p === null) return
        if (typeof p === 'object') { midi.emit({ type: 'pad', pad: p.pad, vel: 100, channel: 10, time: performance.now(), source: 'mouse' }); return }
        e.currentTarget.setPointerCapture(e.pointerId) // the release reaches us even if the finger slides off
        down.current.set(e.pointerId, p)
        midi.emit({ type: 'on', pitch: p, vel: 85, channel: 1, time: performance.now(), source: 'mouse' })
      }}
      onPointerUp={release}
      onPointerCancel={release}
    />
  )
}
