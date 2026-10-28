import { useEffect, useRef } from 'react'
import type { Attempt, Feedback } from '../engine/feedback'
import type { Summary } from '../engine/scorer'
import type { PracticeMode } from '../music/types'
import { Mascot } from './Mascot'

export function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="stars" aria-label={`${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => <span key={i} className={i < n ? '' : 'off'}>★</span>)}
    </span>
  )
}

export interface RunStats { summary: Summary; maxCombo: number; score: number }

export type Rank = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D'
/** osu!-style rank from accuracy (hits / notes), timing ((perfect + good) / hits; null when untimed) and wrong keys. */
export function rankOf(accuracy: number, timing: number | null, extras = 0): Rank {
  const t = timing ?? 1
  if (accuracy >= 1 && t >= 1 && extras === 0) return 'SS'
  if (accuracy >= 0.95 && t >= 0.9) return 'S'
  if (accuracy >= 0.9 && t >= 0.75) return 'A'
  if (accuracy >= 0.8) return 'B'
  if (accuracy >= 0.65) return 'C'
  return 'D'
}

export function RankBadge({ rank, size = 'sm' }: { rank: Rank; size?: 'sm' | 'xl' }) {
  return <span className={`rank rank-${rank} rank-${size}`} aria-label={`Rank ${rank}`}>{rank}</span>
}

/** A number that counts up once when shown. Writes textContent from rAF, so React renders it once. */
function CountUp({ to, digits = 0, suffix = '', delay = 0 }: { to: number; digits?: number; suffix?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current!
    const fmt = (v: number) => (digits ? v.toFixed(digits) : Math.round(v).toLocaleString()) + suffix
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return }
    const t0 = performance.now() + delay
    let raf = 0
    const f = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / 900))
      el.textContent = fmt(to * (1 - (1 - t) ** 4))
      if (t < 1) raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [to, digits, suffix, delay])
  return <span ref={ref}>{digits ? (0).toFixed(digits) : 0}{suffix}</span>
}

export function Results({ fb, run, onRetry, onNext, onMode, mode, history, lessonPass }: {
  fb: Feedback
  run?: RunStats | null
  onRetry: () => void
  onNext?: () => void
  onMode?: (m: 'wait' | 'rhythm' | 'loop') => void
  mode: PracticeMode
  history: Attempt[]
  lessonPass: boolean
}) {
  const recent = history.slice(-10)
  // Focus "Try again" for the keyboard without scrolling the card away from the rank at its top.
  const retry = useRef<HTMLButtonElement>(null)
  useEffect(() => { retry.current?.focus({ preventScroll: true }) }, [])
  const s = run?.summary
  const rank = s ? rankOf(s.accuracy, s.timing, s.extras) : null
  const counts: [string, number, string][] = !s ? [] : s.timing === null
    ? [['Correct', s.hits, 'var(--ok)'], ['Missed', s.missed, 'var(--bad)'], ['Wrong keys', s.extras, 'var(--warn)']]
    : [['Perfect', s.perfect, 'var(--accent-2)'], ['Good', s.good, 'var(--ok)'], ['Early', s.early, 'var(--warn)'], ['Late', s.late, 'var(--left)'], ['Miss', s.missed, 'var(--bad)']]
  return (
    <div className="overlay" role="dialog" aria-label="Results">
      <div className="card col results">
        {s && rank && (
          <div className="ranking">
            <div className="ranking-grade"><RankBadge rank={rank} size="xl" /><span className="stars-lg"><Stars n={fb.stars} /></span></div>
            <div className="ranking-stats">
              <div className="ranking-score"><span className="sub">Score</span><b><CountUp to={run!.score} /></b></div>
              <div className="ranking-row">
                <div><span className="sub">Accuracy</span><b><CountUp to={s.accuracy * 100} digits={1} suffix="%" delay={120} /></b></div>
                {s.timing !== null && <div><span className="sub">Timing</span><b><CountUp to={s.timing * 100} digits={1} suffix="%" delay={200} /></b></div>}
                <div><span className="sub">Max combo</span><b><CountUp to={run!.maxCombo} suffix="×" delay={280} /></b></div>
              </div>
              <div className="judgments">
                {counts.map(([label, n, color], i) => (
                  <div key={label} style={{ '--c': color, animationDelay: `${300 + i * 60}ms` } as React.CSSProperties}><b><CountUp to={n} delay={300 + i * 60} /></b><span>{label}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 10 }}><Mascot size={54} mood={fb.stars >= 2 ? 'star' : fb.stars === 1 ? 'happy' : 'calm'} /><h1>{fb.headline}</h1></div>
          {!s && <span style={{ fontSize: '1.8rem' }}><Stars n={fb.stars} /></span>}
        </div>
        <div className="feedback">
          <div className="col" style={{ gap: 6 }}>
            <h3 style={{ color: 'var(--ok)' }}>What went well</h3>
            {fb.good.map((g, i) => <p key={i}>✓ {g}</p>)}
          </div>
          {fb.improve.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <h3 style={{ color: 'var(--warn)' }}>What to work on</h3>
              {fb.improve.map((g, i) => <p key={i}>→ {g}</p>)}
            </div>
          )}
        </div>
        <div className="callout"><b>Next: </b>{fb.next}</div>
        {recent.length > 1 && (
          <div>
            <p className="sub" style={{ marginBottom: 6 }}>Your last {recent.length} attempts in this mode (accuracy{mode !== 'wait' ? ' / timing' : ''})</p>
            <div className="row history" style={{ alignItems: 'flex-end', gap: 4, height: 54 }}>
              {recent.map((a, i) => (
                <div key={i} title={`${Math.round(a.accuracy * 100)}% at ${a.bpm} BPM`} style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: '100%' }}>
                  <div style={{ width: 9, height: `${Math.max(4, a.accuracy * 100)}%`, background: 'var(--right)', borderRadius: 3, opacity: i === recent.length - 1 ? 1 : 0.55 }} />
                  {a.timing !== null && <div style={{ width: 9, height: `${Math.max(4, a.timing * 100)}%`, background: 'var(--accent-2)', borderRadius: 3, opacity: i === recent.length - 1 ? 1 : 0.55 }} />}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={onRetry} ref={retry}>↺ Try again</button>
          {lessonPass && onMode && mode === 'wait' && fb.stars >= 1 && <button className="btn" onClick={() => onMode('rhythm')}>Rhythm mode</button>}
          {lessonPass && onMode && mode === 'rhythm' && fb.stars === 0 && <button className="btn" onClick={() => onMode('wait')}>Back to Wait mode</button>}
          {lessonPass && onMode && mode === 'rhythm' && fb.stars === 1 && <button className="btn" onClick={() => onMode('loop')}>Loop the hard bars</button>}
          <span className="spacer" />
          {onNext && fb.stars >= 1 && <button className="btn" onClick={onNext}>Next lesson →</button>}
        </div>
      </div>
    </div>
  )
}
