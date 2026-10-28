import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { audio } from '../audio/audioEngine'
import { track } from '../analytics'
import { improvFeedback, makeFeedback, type Feedback } from '../engine/feedback'
import type { Grade, ScoredNote, Summary } from '../engine/scorer'
import { Session, type SessionState } from '../engine/session'
import { midi } from '../midi/midiInput'
import { handPosition } from '../music/fingering'
import { noteNameOct } from '../music/theory'
import type { Lesson, NoteEvent, PracticeMode } from '../music/types'
import { currentDrums, kit } from '../music/drums'
import { kirtan } from '../audio/kirtan'
import { displayRange, Effects, noteColor, type Scene } from '../render/pianoRenderer'
import { logPractice, progress, recordAttempt, settings, useStore } from '../store/store'
import { PianoCanvas } from './PianoCanvas'
import { TheoryPanel } from './TheoryPanel'
import { padHits } from './live'
import { Results, Stars, type RunStats } from './Results'

type PlayMode = Exclude<PracticeMode, 'free'>
const POINTS: Record<Grade, number> = { perfect: 300, good: 200, early: 100, late: 100, hit: 300, missed: 0 }
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches
// A phone held upright fits the 25 keys into ~330 px; sideways they get ~820 px.
const PORTRAIT_PHONE = '(orientation: portrait) and (max-width: 600px)'
const onOrientation = (cb: () => void) => { const m = matchMedia(PORTRAIT_PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) }
const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: 'watch', label: 'Watch', hint: 'Listen and watch the piece first.' },
  { id: 'wait', label: 'Wait', hint: 'The music waits for you to press the right keys. No time pressure.' },
  { id: 'rhythm', label: 'Rhythm', hint: 'Play along in time. Notes are graded on timing.' },
  { id: 'loop', label: 'Loop', hint: 'Repeat a few bars until they feel easy.' },
]

/** Keyboard range the user's device covers right now, if we know it. */
export function deviceRange(): [number, number] {
  const s = settings.get()
  const lo = s.lowestKey ?? 48
  return [lo, lo + s.keyCount - 1]
}

export function rangeAdvice(notes: NoteEvent[]): string | null {
  notes = notes.filter((n) => n.drum === undefined) // pads don't depend on the keyboard's octave
  if (!notes.length) return null
  const lo = Math.min(...notes.map((n) => n.pitch)), hi = Math.max(...notes.map((n) => n.pitch))
  const [dlo, dhi] = deviceRange()
  if (lo >= dlo && hi <= dhi) return null
  if (hi - lo > dhi - dlo) return `This piece spans ${noteNameOct(lo)}–${noteNameOct(hi)}, wider than your keyboard. Use the octave buttons when the notes move off the edge.`
  const shift = lo < dlo ? -Math.ceil((dlo - lo) / 12) : Math.ceil((hi - dhi) / 12)
  return `This piece needs ${noteNameOct(lo)}–${noteNameOct(hi)}. Press Oct ${shift > 0 ? '+' : '−'} ${Math.abs(shift)}× on your keyboard.`
}

export function Practice({ lesson, onExit, onNext }: { lesson: Lesson; onExit: () => void; onNext?: () => void }) {
  const st = useStore(settings)
  const prog = useStore(progress)
  const hasLeft = lesson.notes.some((n) => n.hand === 'L'), hasRight = lesson.notes.some((n) => n.hand === 'R')
  const [mode, setMode] = useState<PlayMode>(lesson.kind === 'improvise' ? 'watch' : 'wait')
  const [hands, setHands] = useState<'R' | 'L' | 'both'>(lesson.hands)
  const [bpm, setBpm] = useState(Math.round(lesson.bpm * (lesson.kind === 'improvise' ? 1 : 0.85)))
  const bars = Math.max(1, Math.ceil(Math.max(0, ...lesson.notes.map((n) => n.start + n.dur)) / lesson.timeSig[0]))
  const [loop, setLoop] = useState<[number, number]>([1, Math.min(bars, 2)])
  const [state, setState] = useState<SessionState>('ready')
  const [result, setResult] = useState<Feedback | null>(null)
  const [run, setRun] = useState<RunStats | null>(null)
  const [showIntro, setShowIntro] = useState(true)
  const portraitPhone = useSyncExternalStore(onOrientation, () => matchMedia(PORTRAIT_PHONE).matches)
  const hud = useRef<HTMLDivElement>(null)
  const toast = useRef<HTMLDivElement>(null)
  const startedAt = useRef(0)
  // Focus Start without scrolling to it: autoFocus scrolled the lesson card down on phones, hiding its title.
  const startBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (showIntro) startBtn.current?.focus({ preventScroll: true }) }, [showIntro])
  const chordEl = useRef<HTMLDivElement>(null)
  const pendingStart = useRef(false)
  // osu!-style live stats: updated from the frame loop through refs, never through React state.
  const fx = useMemo(() => new Effects(), [])
  const stats = useRef({ combo: 0, max: 0, score: 0, shown: -1, judged: 0, hits: 0, wrong: 0, seen: 0, lastAcc: -1, last: 0, hud: '', chord: '', toast: '' })
  const statsBox = useRef<HTMLDivElement>(null)
  const comboEl = useRef<HTMLSpanElement>(null)
  const ghostEl = useRef<HTMLSpanElement>(null)
  const scoreEl = useRef<HTMLElement>(null)
  const accEl = useRef<HTMLSpanElement>(null)
  const resetStats = () => {
    Object.assign(stats.current, { combo: 0, max: 0, score: 0, shown: -1, judged: 0, hits: 0, wrong: 0, seen: 0, lastAcc: -1 })
    fx.clear()
    if (comboEl.current) comboEl.current.textContent = ''
  }

  // One session per (mode, hands, loop). Tempo changes are applied live.
  const session = useMemo(() => new Session(lesson, {
    mode, hands, bpm, metronome: st.metronome, calibration: st.calibrationMs / 1000,
    loop: mode === 'loop' ? [(loop[0] - 1) * lesson.timeSig[0], loop[1] * lesson.timeSig[0]] : null,
  }, audio), [lesson, mode, hands, loop]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { session.setBpm(bpm) }, [session, bpm])
  const hasDrums = lesson.notes.some((n) => n.drum !== undefined)
  const hasKeys = lesson.notes.some((n) => n.drum === undefined)

  // A lesson brings its own drums: the free-play kirtan rhythm loop pauses meanwhile (its drone keeps playing).
  useEffect(() => { audio.performFx = false; kirtan.lessonOpen = true; return () => { audio.performFx = true; kirtan.lessonOpen = false } }, [])

  // Keep the screen on while a lesson is open: a phone that dims and locks mid-lesson also suspends the sound.
  // The browser drops the lock whenever the page is hidden, so it is asked for again on return.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null, gone = false
    const ask = () => {
      if (document.visibilityState !== 'visible' || lock && !lock.released) return
      navigator.wakeLock?.request('screen').then((l) => { if (gone) void l.release(); else lock = l }, () => { /* refused (battery saver): the screen may dim */ })
    }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => { gone = true; document.removeEventListener('visibilitychange', ask); void lock?.release() }
  }, [])

  // Some lessons choose their sound (bends need a synth); a synth lesson's backing uses the electric piano so it doesn't
  // bend along, while a harmonium or bansuri lesson keeps its backing on the same instrument.
  useEffect(() => {
    if (!lesson.instrument) return
    const prev = audio.instrument
    audio.instrument = lesson.instrument
    audio.backing = lesson.instrument === 'synth' ? 'epiano' : null
    return () => { audio.instrument = prev; audio.backing = null; audio.setBend(0); audio.setMod(0) }
  }, [lesson])
  useEffect(() => {
    if (!lesson.kit) return
    const prev = kit.id
    kit.id = lesson.kit
    return () => { kit.id = prev }
  }, [lesson])
  useEffect(() => { session.opts.metronome = st.metronome; session.opts.calibration = st.calibrationMs / 1000 }, [session, st.metronome, st.calibrationMs])

  // Lesson note → grade, so the renderer can colour the falling note that was hit or missed.
  const gradeMap = useRef(new Map<NoteEvent, Grade>())

  useEffect(() => {
    setState('ready'); setResult(null); setRun(null)
    resetStats()
    gradeMap.current.clear() // old hit/miss colours belong to the previous mode
    session.onState = setState
    session.onDone = (sum) => {
      const minutes = (performance.now() - startedAt.current) / 60000
      logPractice(minutes)
      const prev = progress.get().lessons[lesson.id]?.attempts ?? []
      // After watching, the natural next step is learning the notes.
      if (mode === 'watch') { setResult(null); setShowIntro(true); if (lesson.kind === 'play') setMode('wait'); return }
      const oneHand = lesson.hands === 'both' && hands !== 'both'
      const fb = makeFeedback(lesson, mode, sum, session.minBpm, prev, oneHand)
      recordAttempt(lesson.id, { date: Date.now(), mode, bpm: session.minBpm, accuracy: sum.accuracy, timing: sum.timing, stars: fb.stars })
      if (fb.stars >= 2) track('lesson-passed', lesson.id, true)
      setRun({ summary: sum as Summary, maxCombo: stats.current.max, score: Math.round(stats.current.score) })
      setResult(fb)
    }
    const off = midi.on((e) => { session.input(e) })
    const onHide = () => { if (document.hidden) session.pause() } // no frames while hidden: pause rather than drift
    document.addEventListener('visibilitychange', onHide)
    if (pendingStart.current) { pendingStart.current = false; void start() }
    return () => { off(); document.removeEventListener('visibilitychange', onHide); session.pause() }
  }, [session, lesson, mode, hands])

  const start = async () => {
    await audio.start()
    audio.setVolume(settings.get().volume)
    setShowIntro(false); setResult(null); setRun(null)
    resetStats()
    gradeMap.current.clear()
    startedAt.current = performance.now()
    track('lesson-started', lesson.id, true)
    session.restart()
  }
  const finishImprov = () => {
    session.pause()
    logPractice((performance.now() - startedAt.current) / 60000)
    const n = lesson.scale?.length ?? 0
    const fb = improvFeedback(session.improvSummary(), n === 5 ? 'pentatonic scale' : n === 6 ? 'blues scale' : lesson.key ? `${lesson.key} scale` : 'scale', lesson.pass.minAccuracy, lesson.instrument === 'synth')
    progress.set((p) => ({ ...p, improvisations: p.improvisations + 1 }))
    recordAttempt(lesson.id, { date: Date.now(), mode: 'free', bpm, accuracy: session.improvSummary().inScale, timing: null, stars: fb.stars })
    if (fb.stars >= 2) track('lesson-passed', lesson.id, true)
    setResult(fb)
  }
  const togglePlay = () => {
    if (state === 'playing' || state === 'waiting') session.pause()
    else if (state === 'paused') session.resume()
    else void start()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'Escape') session.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const breakCombo = () => {
    const st = stats.current
    if (st.combo >= 3 && ghostEl.current && !calm()) {
      ghostEl.current.textContent = `${st.combo}×`
      ghostEl.current.animate([{ opacity: 0.9, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(18px) scale(1.5)' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' })
    }
    st.combo = 0
    if (comboEl.current) comboEl.current.textContent = ''
  }
  const judged = (n: ScoredNote, now: number) => {
    const st = stats.current, g = n.grade!
    st.judged++
    if (g === 'missed') { breakCombo(); fx.judge(n.pitch, 'missed', now); return }
    st.hits++
    st.combo++
    st.max = Math.max(st.max, st.combo)
    st.score += POINTS[g] * (1 + Math.min(st.combo, 100) / 50)
    fx.judge(n.pitch, g, now, n.drum !== undefined ? currentDrums()[n.drum].color : noteColor(n.hand))
    if (st.combo === 10 || st.combo === 25 || st.combo % 50 === 0) fx.milestone(st.combo, now)
    if (comboEl.current) {
      comboEl.current.textContent = `${st.combo}×`
      if (!calm()) comboEl.current.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(.34,1.56,.64,1)' })
    }
  }

  const lastScorer = useRef(session.scorer)
  const tick = () => {
    session.tick()
    const now = performance.now(), st = stats.current
    // New loop pass (or restart): forget the previous pass's hit/miss colours; combo and score carry on.
    if (lastScorer.current !== session.scorer) {
      gradeMap.current.clear(); lastScorer.current = session.scorer
      st.judged = 0; st.hits = 0; st.wrong = 0; st.seen = 0
    }
    // Only the notes graded since the last frame (the scorer keeps them in order), not a rescan of the piece.
    const graded = session.scorer.graded
    for (; st.seen < graded.length; st.seen++) {
      const n = graded[st.seen]
      gradeMap.current.set(n.src, n.grade!)
      judged(n, now)
    }
    const wrong = session.scorer.wrong
    for (; st.wrong < wrong.length; st.wrong++) { fx.judge(wrong[st.wrong].played, 'wrong', now); breakCombo() }
    if (statsBox.current) {
      const show = lesson.kind === 'play' && mode !== 'watch' && session.state !== 'ready'
      statsBox.current.style.display = show ? '' : 'none'
      // Score counts up smoothly toward its target; text is written only when the shown number changes.
      const dt = Math.min(0.1, (now - st.last) / 1000)
      const target = st.score, next = st.shown < 0 ? target : st.shown + (target - st.shown) * Math.min(1, dt * 9)
      if (Math.round(next) !== Math.round(st.shown) && scoreEl.current) scoreEl.current.textContent = Math.round(next).toLocaleString()
      st.shown = next
      const acc = st.judged ? Math.round((st.hits / st.judged) * 1000) : 1000
      if (acc !== st.lastAcc && accEl.current) { accEl.current.textContent = `${(acc / 10).toFixed(1)}%`; st.lastAcc = acc }
    }
    st.last = now
    // HUD text without React re-renders; the DOM is touched only when the text actually changes.
    const b = session.transport.beat
    let text = ''
    if (session.state === 'playing' && b < session.countInEnd) text = `Count-in  ${Math.ceil(session.countInEnd - b)}`
    else if (session.state === 'waiting') text = 'Play the highlighted keys'
    else if (session.state === 'paused') text = 'Paused – press Space'
    else if (session.state === 'playing' && session.timed) {
      text = st.judged ? `${st.hits}/${st.judged} notes · bar ${Math.floor(b / lesson.timeSig[0]) + 1}` : `Bar ${Math.floor(Math.max(0, b) / lesson.timeSig[0]) + 1}`
      if (session.opts.mode === 'loop') text += ` · pass ${session.passes.length + 1}`
    } else if (session.state === 'playing') text = `Bar ${Math.floor(Math.max(0, b) / lesson.timeSig[0]) + 1}`
    if (text !== st.hud && hud.current) { hud.current.textContent = text; hud.current.style.display = text ? '' : 'none'; st.hud = text }
    let chord = ''
    for (const c of lesson.chords ?? []) { if (c.beat > Math.max(0, b) + 0.01) break; chord = `Chord: ${c.name}` }
    if (chord !== st.chord && chordEl.current) { chordEl.current.textContent = chord; chordEl.current.style.display = chord ? '' : 'none'; st.chord = chord }
    const h = session.octaveHint
    const hint = h ? `One octave ${h === 'up' ? 'too low – press Oct +' : 'too high – press Oct −'} (or move your hand ${h === 'up' ? 'right' : 'left'})` : ''
    if (hint !== st.toast && toast.current) { toast.current.textContent = hint; toast.current.style.display = hint ? '' : 'none'; st.toast = hint }
  }

  const range = useMemo(() => {
    const ps = lesson.notes.filter((n) => n.drum === undefined).map((n) => n.pitch).concat(lesson.phrases?.flat() ?? [])
    const [dlo, dhi] = deviceRange()
    return displayRange(Math.min(dlo, ...ps), Math.max(dhi, ...ps))
  }, [lesson])

  // Hand position overlay: shown while the button is hovered/focused, or pinned by clicking it.
  const [handsHover, setHandsHover] = useState(false)
  const [handsPinned, setHandsPinned] = useState(false)
  const hasFingering = lesson.notes.some((n) => n.finger)
  const fingers = () => {
    const b = session.visualBeat(), shown = mode === 'watch' || hands === 'both' ? (['R', 'L'] as const) : [hands]
    return shown.flatMap((h) => handPosition(lesson.notes, h, b, lesson.timeSig[0]))
  }

  const scene = (): Scene => ({
    beat: session.visualBeat(),
    notes: lesson.notes,
    grades: gradeMap.current,
    userHands: mode === 'watch' || lesson.kind !== 'play' ? 'none' : hands,
    range,
    held: midi.held,
    flashes: session.flashes,
    pending: mode === 'wait' && session.state !== 'ready' && session.state !== 'done' ? session.scorer.pendingPitches() : undefined,
    labels: st.labels,
    fingers: handsHover || handsPinned ? fingers() : undefined,
    beatsVisible: st.beatsVisible,
    beatsPerBar: lesson.timeSig[0],
    loop: session.opts.loop,
    highlightPcs: lesson.kind === 'improvise' ? lesson.scale : undefined,
    pads: hasDrums,
    padShare: hasKeys ? 0.42 : 0.65, // a drums-only lesson barely needs the keyboard
    padHits,
    waiting: session.state === 'waiting',
    live: session.state === 'playing',
    autoAlpha: mode === 'watch' ? 0.92 : undefined,
  })

  // The View menu closes when you click anywhere else.
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => { const m = menuRef.current; if (m?.open && !m.contains(e.target as Node)) m.open = false }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const lp = prog.lessons[lesson.id]
  const advice = rangeAdvice(lesson.notes)
  const running = state === 'playing' || state === 'waiting'

  return (
    <div className="practice">
      <div className="practice-bar">
        <button className="btn ghost small" onClick={onExit} aria-label="Back to lessons">← Back</button>
        <div className="col" style={{ gap: 0, marginRight: 8 }}>
          <b>{lesson.title}</b>
          <span className="sub" style={{ fontSize: '0.8rem' }}>Stage {lesson.stage} · {lesson.key ?? ''} {lp ? <Stars n={lp.stars} /> : null}</span>
        </div>
        {lesson.kind === 'play' && (
          <div className="seg" role="tablist" aria-label="Practice mode">
            {MODES.map((m) => <button key={m.id} title={m.hint} className={mode === m.id ? 'active' : ''} onClick={() => { setMode(m.id); setShowIntro(false) }}>{m.label}</button>)}
          </div>
        )}
        {lesson.kind === 'play' && hasLeft && hasRight && mode !== 'watch' && (
          <div className="seg" aria-label="Hands">
            {(['R', 'L', 'both'] as const).map((h) => <button key={h} className={hands === h ? 'active' : ''} onClick={() => setHands(h)}>{h === 'both' ? 'Both hands' : h === 'R' ? 'Right' : 'Left'}</button>)}
          </div>
        )}
        {mode === 'loop' && (
          <span className="row" style={{ gap: 4 }}>
            <span className="sub">Bars</span>
            <input type="number" min={1} max={bars} value={loop[0]} style={{ width: 54 }} onChange={(e) => { const a = Math.max(1, Math.min(bars, +e.target.value)); setLoop([a, Math.max(a, loop[1])]) }} />
            –
            <input type="number" min={1} max={bars} value={loop[1]} style={{ width: 54 }} onChange={(e) => { const b = Math.max(1, Math.min(bars, +e.target.value)); setLoop([Math.min(loop[0], b), b]) }} />
          </span>
        )}
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }} title="Tempo">
          <span className="sub">♩</span>
          <input type="range" min={Math.max(30, Math.round(lesson.bpm * 0.4))} max={Math.round(lesson.bpm * 1.3)} value={bpm} onChange={(e) => setBpm(+e.target.value)} aria-label="Tempo" />
          <span className="mono" style={{ width: 62 }}>{bpm} BPM</span>
        </label>
        {hasFingering && (
          <button className={`btn small ${handsPinned ? 'on' : ''}`} aria-pressed={handsPinned}
            title="Hover to see where each finger rests for the next passage; click to keep it on"
            // Hover preview is for a mouse only: on a phone a tap also counts as hover (and focus), so the old
            // hover/focus handlers kept the overlay up after the second tap meant to switch it off.
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHandsHover(true) }} onPointerLeave={() => setHandsHover(false)}
            onClick={() => { setHandsPinned(!handsPinned); setHandsHover(false) }}>✋ Hand position</button>
        )}
        {/* Less frequent options live in a small menu, so the bar stays one clean row. */}
        <details className="menu" ref={menuRef}>
          <summary className={`btn small${st.metronome ? ' on' : ''}`} aria-label="View and metronome options">View ▾</summary>
          <div className="menu-panel">
            <label className="row" style={{ justifyContent: 'space-between' }}>Metronome <input type="checkbox" checked={st.metronome} onChange={() => settings.set({ metronome: !st.metronome })} /></label>
            <label className="field">Note labels
              <select value={st.labels} onChange={(e) => settings.set({ labels: e.target.value as Scene['labels'] })} aria-label="Note labels">
                <option value="name">C D E</option>
                <option value="octave">C4 D4</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="field" title="Scroll speed: how many beats are visible">Zoom
              <input type="range" min={3} max={14} value={17 - st.beatsVisible} onChange={(e) => settings.set({ beatsVisible: 17 - +e.target.value })} aria-label="Scroll speed" />
            </label>
          </div>
        </details>
        <button className="btn small" onClick={() => void start()} title="Restart">↺</button>
        <button className="btn primary small" onClick={togglePlay} style={{ minWidth: 86 }}>{running ? '❚❚ Pause' : state === 'paused' ? '▶ Resume' : '▶ Play'}</button>
        {lesson.kind === 'improvise' && running && <button className="btn small" onClick={finishImprov}>Finish</button>}
      </div>

      <div className="practice-body">
        <div className="canvas-wrap">
          <PianoCanvas scene={scene} tick={tick} fx={fx} />
          <div className="hud"><div className="pill" ref={hud} style={{ display: 'none' }} /></div>
          <div className="hud-stats" ref={statsBox} style={{ display: 'none' }} aria-hidden>
            <div className="hud-combo"><span ref={comboEl} /><span className="ghost" ref={ghostEl} /></div>
            <div className="hud-score"><b ref={scoreEl}>0</b><span ref={accEl}>100.0%</span></div>
          </div>
          <div className="toast"><div className="callout warn" ref={toast} style={{ display: 'none' }} /></div>
          {showIntro && !result && (
            <div className="overlay">
              <div className="card col" style={{ gap: 14 }}>
                <span className="stage-num">Stage {lesson.stage}</span>
                <h1>{lesson.title}</h1>
                <p style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{lesson.goal}</p>
                {portraitPhone && <div className="callout">📱 Turn your phone sideways: the keys get about 2.5× bigger.</div>}
                {lesson.intro.map((p, i) => <p key={i}>{p}</p>)}
                {advice && <div className="callout warn">{advice}</div>}
                {lesson.kind === 'play' && <p className="sub">Start in <b>Wait</b> mode to learn the notes, then switch to <b>Rhythm</b> to play in time. Space = play/pause.</p>}
                {lesson.kind === 'improvise' && <p className="sub">The backing loops until you press <b>Finish</b>. Purple dots mark the notes of the scale – any of them will sound good.</p>}
                <div className="row">
                  <button className="btn primary" onClick={() => void start()} ref={startBtn}>▶ Start{lesson.kind === 'play' ? ` in ${MODES.find((m) => m.id === mode)!.label} mode` : ''}</button>
                  {lesson.kind === 'play' && mode !== 'watch' && <button className="btn" onClick={() => { pendingStart.current = true; setMode('watch') }}>Watch it first</button>}
                </div>
              </div>
            </div>
          )}
          {result && (
            <Results fb={result} run={run} lessonPass={lesson.kind === 'play'} onRetry={() => void start()} onNext={onNext}
              onMode={lesson.kind === 'play' ? (m) => { setMode(m); setResult(null); setShowIntro(true) } : undefined} mode={mode}
              history={lp?.attempts.filter((a) => a.mode === mode) ?? []} />
          )}
        </div>
        <aside className="side">
          {lesson.chords?.length ? <div className="pill" ref={chordEl} style={{ alignSelf: 'flex-start', fontSize: '1rem', display: 'none' }} /> : null}
          {lesson.tips?.length ? (
            <div className="col" style={{ gap: 6 }}>
              <h3>Tips</h3>
              {lesson.tips.map((t, i) => <p key={i} className="sub">• {t}</p>)}
            </div>
          ) : null}
          <TheoryPanel musicalKey={lesson.key} />
        </aside>
      </div>
    </div>
  )
}
