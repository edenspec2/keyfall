import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { audio } from './audio/audioEngine'
import { CURRICULUM } from './lessons/curriculum'
import { midi } from './midi/midiInput'
import type { Lesson } from './music/types'
import { settings, useStore } from './store/store'
import { Create } from './ui/Create'
import { EchoLesson } from './ui/EchoLesson'
import { Explore } from './ui/Explore'
import { Learn, nextLesson } from './ui/Learn'
import { initLiveInput } from './ui/live'
import { Onboarding } from './ui/Onboarding'
import { Practice } from './ui/Practice'
import { ProgressPage } from './ui/ProgressPage'
import { MidiStatusPill, Settings } from './ui/Settings'
import { KnobReadout, SoundPanel } from './ui/SoundPanel'
import { progress } from './store/store'
import { setRenderTheme } from './render/pianoRenderer'

type Page = 'learn' | 'practice' | 'explore' | 'create' | 'progress' | 'settings'

const ICONS: Record<Page, string> = {
  learn: 'M4 5h7v14H4zM13 5h7v14h-7z',
  practice: 'M4 4h3v10H4zM10.5 7h3v7h-3zM17 3h3v11h-3zM3 17h18v3H3z',
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  create: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  progress: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
}
/** Page changes cross-fade with the View Transitions API (Chrome/Edge); elsewhere CSS plays an enter animation. */
function transition(update: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  document.startViewTransition(() => flushSync(update))
}

const LABELS: Record<Page, string> = { learn: 'Learn', practice: 'Practice', explore: 'Explore', create: 'Create', progress: 'Progress', settings: 'Settings' }

export default function App() {
  const st = useStore(settings)
  const [page, setPage] = useState<Page>('learn')
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [setup, setSetup] = useState(!st.onboarded)
  const [soundOpen, setSoundOpen] = useState(false)
  useEffect(() => {
    if (!soundOpen) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setSoundOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [soundOpen])
  const [soundOn, setSoundOn] = useState(audio.started)

  // Theme: tokens in CSS switch on data-theme; the canvas gets the matching palette.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const t = st.theme === 'system' ? (mq.matches ? 'dark' : 'light') : st.theme
      document.documentElement.dataset.theme = t
      setRenderTheme(t)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [st.theme])

  useEffect(() => {
    document.documentElement.classList.toggle('vt', !!document.startViewTransition)
    initLiveInput()
    // Returning users: reconnect MIDI silently (Chrome remembers the permission).
    if (settings.get().onboarded) void midi.connect()
  }, [])

  // Browsers only allow audio after a gesture. These are the events they accept as one (a touch counts when the
  // finger lifts, not when it lands), and we keep listening: a phone can suspend audio again later.
  const [needTap, setNeedTap] = useState(false)
  useEffect(() => {
    const go = () => { if (!audio.running) void audio.start().then(() => audio.setVolume(settings.get().volume)) }
    const events = ['pointerup', 'touchend', 'click', 'keydown'] as const
    for (const e of events) window.addEventListener(e, go, true)
    const poll = setInterval(() => { const on = audio.running; setSoundOn(on); if (on) setNeedTap(false) }, 400)
    // Playing the MiniLab is not a gesture: if sound is off, say so instead of staying silent.
    const off = midi.on((e) => { if ((e.type === 'on' || e.type === 'pad') && !audio.running) setNeedTap(true) })
    return () => { for (const e of events) window.removeEventListener(e, go, true); clearInterval(poll); off() }
  }, [])

  const go = (p: Page) => { if (p !== page) transition(() => setPage(p)) }
  const open = (l: Lesson) => transition(() => { setLesson(l); setPage('practice') })
  const at = lesson ? CURRICULUM.indexOf(lesson) : -1
  const next = at >= 0 ? CURRICULUM[at + 1] : undefined // Explore's scale/chord drills have no "next lesson"

  if (setup) {
    return <div className="main onboarding" style={{ height: '100dvh' }}><Onboarding done={(start) => transition(() => { setSetup(false); if (start) { setLesson(CURRICULUM[0]); setPage('practice') } })} /></div>
  }

  const practiceLesson = lesson ?? nextLesson(progress.get())
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand"><div className="brand-mark" /><span>Keyfall</span></div>
        {(Object.keys(LABELS) as Page[]).map((p) => (
          <button key={p} className={`nav-btn ${page === p ? 'active' : ''}`} onClick={() => go(p)} aria-current={page === p ? 'page' : undefined}>
            {page === p && <span className="nav-indicator" aria-hidden />}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[p]} /></svg>
            <span>{LABELS[p]}</span>
          </button>
        ))}
        <button className={`nav-btn ${soundOpen ? 'active' : ''}`} onClick={() => setSoundOpen(!soundOpen)} aria-expanded={soundOpen} aria-controls="sound-drawer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
          <span>Sound</span>
        </button>
        <div className="sidebar-foot">
          <MidiStatusPill />
          {!soundOn && <span className="pill sound-pill" title="Click anywhere to enable sound"><span className="dot warn" /><span>Click to enable sound</span></span>}
        </div>
      </nav>
      <main className="main">
        {page === 'learn' && <Learn open={open} />}
        {page === 'practice' && (practiceLesson.kind === 'echo'
          ? <EchoLesson key={practiceLesson.id} lesson={practiceLesson} onExit={() => go('learn')} onNext={next ? () => open(next) : undefined} />
          : <Practice key={practiceLesson.id} lesson={practiceLesson} onExit={() => go('learn')} onNext={next ? () => open(next) : undefined} />)}
        {page === 'explore' && <Explore onPractice={open} />}
        {page === 'create' && <Create />}
        {page === 'progress' && <ProgressPage />}
        {page === 'settings' && <Settings rerunSetup={() => transition(() => setSetup(true))} />}
      </main>
      {soundOpen && <div className="drawer-backdrop" onClick={() => setSoundOpen(false)} aria-hidden />}
      <aside id="sound-drawer" className={`drawer ${soundOpen ? 'open' : ''}`} aria-label="Sound" aria-hidden={!soundOpen} inert={!soundOpen}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Sound</h2>
          <button className="btn ghost small" onClick={() => setSoundOpen(false)} aria-label="Close sound panel">✕</button>
        </div>
        <SoundPanel compact />
      </aside>
      <KnobReadout />
      {!soundOn && <button className={`sound-gate${needTap ? ' show' : ''}`} onClick={() => void audio.start()}>🔇 Tap to turn on sound</button>}
    </div>
  )
}
