import { CURRICULUM, STAGES } from '../lessons/curriculum'
import { library, progress, streak, useStore } from '../store/store'
import { Stars } from './Results'
import { Mascot } from './Mascot'

export function ProgressPage() {
  const p = useStore(progress)
  const lib = useStore(library)
  const days = Object.entries(p.days)
  const totalMin = days.reduce((a, [, m]) => a + m, 0)
  const attempts = CURRICULUM.flatMap((l) => (p.lessons[l.id]?.attempts ?? []).map((a) => ({ ...a, lesson: l })))
    .sort((a, b) => b.date - a.date)
  const mastered = CURRICULUM.filter((l) => (p.lessons[l.id]?.stars ?? 0) >= 2).length

  // Last 28 days heat strip.
  const strip = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (27 - i))
    const k = d.toLocaleDateString('sv')
    return { k, m: p.days[k] ?? 0 }
  })

  // Skills = average best accuracy of the lessons in each stage that were tried.
  const skills = STAGES.map((s) => {
    const ls = CURRICULUM.filter((l) => l.stage === s.stage)
    const tried = ls.filter((l) => p.lessons[l.id])
    const stars = ls.reduce((a, l) => a + (p.lessons[l.id]?.stars ?? 0), 0)
    return { s, pct: stars / (ls.length * 3), tried: tried.length, n: ls.length }
  })

  return (
    <div className="page">
      <div className="page-head"><div><h1>Progress</h1><p className="sub">Measured from what you played – not from time spent.</p></div></div>
      <div className="grid stat-grid">
        <div className="card"><p className="sub">Practice streak</p><div className="big-key">{streak(p.days)} <span style={{ fontSize: '1rem' }}>days</span></div></div>
        <div className="card"><p className="sub">Time practised</p><div className="big-key">{Math.round(totalMin)} <span style={{ fontSize: '1rem' }}>min</span></div></div>
        <div className="card"><p className="sub">Lessons passed (★★+)</p><div className="big-key">{mastered} <span style={{ fontSize: '1rem' }}>/ {CURRICULUM.length}</span></div></div>
        <div className="card"><p className="sub">Your creations</p><div className="big-key">{lib.items.length} <span style={{ fontSize: '1rem' }}>songs · {p.improvisations} jams</span></div></div>
      </div>

      <div className="card col">
        <h3>Last 4 weeks</h3>
        <div className="row" style={{ gap: 4 }}>
          {strip.map((d) => <div key={d.k} className="heat" title={`${d.k}: ${Math.round(d.m)} min`} style={d.m ? { background: `rgba(var(--heat), ${Math.min(1, 0.25 + d.m / 30)})` } : undefined} />)}
        </div>
      </div>

      <div className="card col">
        <h3>Skills</h3>
        {skills.map(({ s, pct, tried, n }) => (
          <div key={s.stage} className="col" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{s.title}</span><span className="sub">{tried}/{n} tried · {Math.round(pct * 100)}% of stars</span></div>
            <div className="bar"><div style={{ width: `${pct * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="card col">
        <h3>Recent practice</h3>
        {!attempts.length && <div className="empty"><Mascot size={48} mood="calm" /><p className="sub">Nothing yet – your first lesson is waiting in Learn.</p></div>}
        {attempts.slice(0, 15).map((a, i) => (
          <div key={i} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
            <span>{a.lesson.title} <span className="sub">· {a.mode} · {a.bpm} BPM</span></span>
            <span className="row"><span className="mono">{Math.round(a.accuracy * 100)}%{a.timing !== null ? ` / ${Math.round(a.timing * 100)}%` : ''}</span><Stars n={a.stars} /><span className="sub" style={{ fontSize: '0.8rem' }}>{new Date(a.date).toLocaleDateString()}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}
