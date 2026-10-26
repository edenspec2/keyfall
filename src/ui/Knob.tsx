import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface KnobProps {
  label: string
  norm: number // knob position 0..1
  text: string // formatted value
  value: number // for aria-valuenow
  min: number
  max: number
  onNorm: (n: number) => void
  onReset: () => void
  steps?: number // discrete positions − 1 (stepped params), so keys and wheel move one step
  bipolar?: boolean // arc grows from the centre (EQ, macros)
  big?: boolean
  dim?: boolean
  children?: ReactNode // learn badge etc.
}

const SWEEP = 270
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** SVG rotary knob: drag vertically (Shift = fine), wheel, double-click resets, arrows/PageUp/PageDown/Home/End. */
export function Knob({ label, norm, text, value, min, max, onNorm, onReset, steps, bipolar, big, dim, children }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; n: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hot, setHot] = useState(false) // value bubble after any change, including hardware CC moves
  const gid = useId()
  const latest = useRef({ norm, onNorm })
  useEffect(() => { latest.current = { norm, onNorm } })
  const step = steps ? 1 / steps : 0.01

  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setHot(true)
    const t = setTimeout(() => setHot(false), 900)
    return () => clearTimeout(t)
  }, [norm])

  // React's onWheel is passive, so preventDefault (keep the page from scrolling) needs a native listener.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { norm, onNorm } = latest.current
      onNorm(clamp01(norm + Math.sign(-e.deltaY) * (steps ? step : e.shiftKey ? 0.004 : 0.02)))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [steps, step])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, n: norm }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    // Accumulate unrounded so stepped params still move on slow drags; 200 px = full travel, Shift = 4× finer.
    d.n = clamp01(d.n + (d.y - e.clientY) / (e.shiftKey ? 800 : 200))
    d.y = e.clientY
    onNorm(d.n)
  }
  const end = () => { drag.current = null; setDragging(false) }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const fine = e.shiftKey && !steps ? 0.1 : 1
    const k: Record<string, number> = { ArrowUp: step * fine, ArrowRight: step * fine, ArrowDown: -step * fine, ArrowLeft: -step * fine, PageUp: Math.max(0.1, step), PageDown: -Math.max(0.1, step) }
    let n: number | null = null
    if (e.key in k) n = norm + k[e.key]
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = 1
    if (n === null) return
    e.preventDefault()
    onNorm(clamp01(n))
  }

  const size = big ? 76 : 54
  const r = size / 2 - 5
  const from = bipolar ? Math.min(norm, 0.5) : 0
  const len = bipolar ? Math.abs(norm - 0.5) : norm
  const arc = SWEEP / 360 * 100 // % of the circle the track covers
  const angle = -SWEEP / 2 + SWEEP * norm

  return (
    <div className={`sp-knob${big ? ' sp-big' : ''}${dim ? ' sp-dim' : ''}${dragging ? ' sp-drag' : ''}${hot ? ' sp-hot' : ''}`}>
      <div
        ref={ref}
        className="sp-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        style={{ width: '100%', maxWidth: size }}
      >
        <svg width="100%" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <defs>
            <radialGradient id={`${gid}b`} cx="40%" cy="32%" r="75%">
              <stop offset="0" stopColor="#3a4157" />
              <stop offset="0.55" stopColor="#1f2433" />
              <stop offset="1" stopColor="#11141c" />
            </radialGradient>
          </defs>
          <g transform={`rotate(${90 + (360 - SWEEP) / 2} ${size / 2} ${size / 2})`}>
            <circle className="sp-track" cx={size / 2} cy={size / 2} r={r} pathLength={100} strokeDasharray={`${arc} 100`} />
            <circle className="sp-arc" cx={size / 2} cy={size / 2} r={r} pathLength={100} strokeDasharray={`${len * arc} 200`} strokeDashoffset={-from * arc} />
          </g>
          <circle className="sp-cap" cx={size / 2} cy={size / 2} r={r - 6} fill={`url(#${gid}b)`} />
          <g className="sp-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 50%' }}>
            <line x1={size / 2} y1={size / 2 - r + 9} x2={size / 2} y2={size / 2 - r + (big ? 18 : 15)} />
          </g>
        </svg>
        <span className="sp-tip" aria-hidden="true">{text}</span>
      </div>
      <span className="sp-label">{label}</span>
      {children}
    </div>
  )
}
