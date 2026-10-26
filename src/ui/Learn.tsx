import { CURRICULUM, STAGES } from '../lessons/curriculum'
import type { Lesson } from '../music/types'
import { progress, settings, useStore, type Progress } from '../store/store'
import { RankBadge, rankOf, Stars } from './Results'

/**
 * A lesson unlocks when the closest earlier *play* lesson has at least one star (notes learned).
 * Improvise and ear-training lessons never block progress – they are playgrounds.
 */
export function isUnlocked(i: number, p: Progress, unlockAll: boolean) {
  if (unlockAll || i === 0) return true
  const after = CURRICULUM[i].unlockAfter
  if (after) return (p.lessons[after]?.stars ?? 0) >= 1
  for (let k = i - 1; k >= 0; k--) {
    if (CURRICULUM[k].kind === 'play') return (p.lessons[CURRICULUM[k].id]?.stars ?? 0) >= 1
  }
  return true
}

/**
 * What "Continue" opens: the first unlocked lesson without a star. A jam or ear-training lesson is skipped once it was
 * tried or a later piece already has stars – playgrounds never block the path.
 */
export function nextLesson(p: Progress, unlockAll: boolean): Lesson {
  const laterPieceDone = (k: number) => CURRICULUM.slice(k + 1).some((l) => l.kind === 'play' && (p.lessons[l.id]?.stars ?? 0) >= 1)
  const i = CURRICULUM.findIndex((l, k) => isUnlocked(k, p, unlockAll) && !(p.lessons[l.id]?.stars)
    && (l.kind === 'play' || (!p.lessons[l.id]?.attempts.length && !laterPieceDone(k))))
  return CURRICULUM[i < 0 ? 0 : i]
}

const KIND_LABEL = { play: 'Piece', improvise: 'Jam', echo: 'Ear training' }

// Song-select tilt: the card leans toward the pointer. CSS variables only, so no React render per move.
const tilt = (e: React.PointerEvent<HTMLElement>) => {
  const el = e.currentTarget, r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
  el.style.setProperty('--ry', `${(x - 0.5) * 7}deg`)
  el.style.setProperty('--rx', `${(0.5 - y) * 7}deg`)
  el.style.setProperty('--mx', `${x * 100}%`)
  el.style.setProperty('--my', `${y * 100}%`)
}
const untilt = (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.setProperty('--rx', '0deg'); e.currentTarget.style.setProperty('--ry', '0deg') }

export function Learn({ open }: { open: (l: Lesson) => void }) {
  const p = useStore(progress)
  const st = useStore(settings)
  const next = nextLesson(p, st.unlockAll)
  const totalStars = Object.values(p.lessons).reduce((a, l) => a + l.stars, 0)

  return (
    <div className="page learn">
      <div className="page-head">
        <div>
          <h1>Learn</h1>
          <p className="sub">Six stages from your first notes to your first composition – all on 25 keys.</p>
        </div>
        <div className="row">
          <span className="pill star-total">★ {totalStars} / {CURRICULUM.length * 3}</span>
          <button className="btn primary" onClick={() => open(next)}>Continue: {next.title} →</button>
        </div>
      </div>

      {STAGES.map((s) => {
        const lessons = CURRICULUM.map((l, i) => ({ l, i })).filter((x) => x.l.stage === s.stage)
        const passed = lessons.filter((x) => (p.lessons[x.l.id]?.stars ?? 0) >= 1).length
        const stars = lessons.reduce((a, x) => a + (p.lessons[x.l.id]?.stars ?? 0), 0)
        return (
          <section key={s.stage} className="col stage" style={{ gap: 14 }}>
            <div className="stage-head">
              <span className="stage-badge" aria-hidden>{s.stage}</span>
              <div className="col" style={{ gap: 2, minWidth: 0 }}>
                <span className="stage-num">Stage {s.stage}</span>
                <h2>{s.title}</h2>
              </div>
              <div className="stage-meter">
                <span className="sub"><b>{passed}</b>/{lessons.length} passed · <span className="stars">★</span> {stars}/{lessons.length * 3}</span>
                <div className="bar"><div style={{ transform: `scaleX(${passed / lessons.length})` }} /></div>
              </div>
            </div>
            <p className="sub stage-blurb">{s.blurb}</p>
            <div className="grid">
              {lessons.map(({ l, i }) => {
                const unlocked = isUnlocked(i, p, st.unlockAll)
                const lp = p.lessons[l.id]
                return (
                  <button key={l.id} className={`card lesson-card kind-${l.kind} ${unlocked ? '' : 'locked'} ${l === next ? 'next' : ''}`} disabled={!unlocked}
                    onPointerMove={unlocked ? tilt : undefined} onPointerLeave={unlocked ? untilt : undefined}
                    onClick={() => unlocked && open(l)} title={unlocked ? l.goal : 'Earn a star in the previous piece to unlock'}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="pill kind">{KIND_LABEL[l.kind]}</span>
                      <span className="row" style={{ gap: 8 }}>
                        {unlocked && l.kind === 'play' && lp?.attempts.length ? <RankBadge rank={rankOf(lp.bestAccuracy, lp.bestTiming)} /> : null}
                        {unlocked ? <Stars n={lp?.stars ?? 0} /> : <span className="sub" aria-label="Locked">🔒</span>}
                      </span>
                    </div>
                    <h3>{l.title}</h3>
                    <p className="sub" style={{ fontSize: '0.88rem' }}>{l.goal}</p>
                    {lp?.attempts.length ? <p className="sub" style={{ fontSize: '0.78rem' }}>Best {Math.round(lp.bestAccuracy * 100)}%{lp.bestTiming !== null ? ` · timing ${Math.round(lp.bestTiming * 100)}%` : ''} · {lp.attempts.length} tries</p> : null}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
