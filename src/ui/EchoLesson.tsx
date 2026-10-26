import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'
import { intervalName, noteName, noteNameOct } from '../music/theory'
import type { Lesson } from '../music/types'
import { displayRange, type Scene } from '../render/pianoRenderer'
import { logPractice, recordAttempt, settings } from '../store/store'
import { PianoCanvas } from './PianoCanvas'
import { deviceRange } from './Practice'
import { Stars } from './Results'
import { trails } from './live'

/** Ear training: the app plays a short phrase, the player finds it on the keyboard by ear. */
export function EchoLesson({ lesson, onExit, onNext }: { lesson: Lesson; onExit: () => void; onNext?: () => void }) {
  const phrases = lesson.phrases ?? []
  const [i, setI] = useState(0)
  const [played, setPlayed] = useState<number[]>([])
  const [status, setStatus] = useState<'intro' | 'listen' | 'answer' | 'right' | 'wrong' | 'done'>('intro')
  const [firstTry, setFirstTry] = useState(0)
  const [hint, setHint] = useState(false)
  const triesRef = useRef(0)
  const startedAt = useRef(performance.now())
  const phrase = phrases[i] ?? []

  // The phrase is passed in so "Next phrase" plays the new one, not the one from the previous render.
  const listen = async (p: number[] = phrase) => {
    await audio.start()
    const spb = 60 / lesson.bpm
    const t0 = audio.now() + 0.15
    p.forEach((x, k) => audio.schedule(x, t0 + k * spb, spb * 0.9, 85))
    playedRef.current = []; setPlayed([]); setStatus('listen')
    setTimeout(() => setStatus((s) => (s === 'listen' ? 'answer' : s)), p.length * spb * 1000 + 150)
  }

  // Answer checking lives outside state updaters (StrictMode runs updaters twice).
  const playedRef = useRef<number[]>([])
  useEffect(() => midi.on((e) => {
    if (e.type !== 'on' || (status !== 'answer' && status !== 'wrong' && status !== 'listen')) return
    const next = [...playedRef.current, e.pitch]
    const k = next.length - 1
    if (next[k] !== phrase[k]) {
      triesRef.current++
      playedRef.current = []; setPlayed([]); setStatus('wrong')
      return
    }
    playedRef.current = next; setPlayed(next)
    if (next.length === phrase.length) {
      if (triesRef.current === 0) setFirstTry((f) => f + 1)
      setStatus('right')
    } else setStatus('answer')
  }), [status, phrase])

  const nextPhrase = () => {
    triesRef.current = 0; setHint(false)
    if (i + 1 >= phrases.length) {
      const acc = firstTry / phrases.length
      const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= lesson.pass.minAccuracy * 0.6 ? 1 : 0
      recordAttempt(lesson.id, { date: Date.now(), mode: 'free', bpm: lesson.bpm, accuracy: acc, timing: null, stars: Math.max(1, stars) })
      logPractice((performance.now() - startedAt.current) / 60000)
      setStatus('done')
      return
    }
    setI(i + 1)
    void listen(phrases[i + 1])
  }

  const [dlo, dhi] = deviceRange()
  const range = displayRange(Math.min(dlo, ...phrases.flat()), Math.max(dhi, ...phrases.flat()))
  const scene = (): Scene => ({
    beat: 0, notes: [], userHands: 'none', range, held: midi.held, labels: settings.get().labels,
    beatsVisible: 6, beatsPerBar: 4, trails, pending: hint && status !== 'right' ? [phrase[played.length]] : undefined,
  })

  return (
    <div className="practice">
      <div className="practice-bar">
        <button className="btn ghost small" onClick={onExit}>← Back</button>
        <b>{lesson.title}</b>
        <span className="sub">Phrase {Math.min(i + 1, phrases.length)} of {phrases.length}</span>
        <span className="spacer" />
        <span className="pill">First-try correct: {firstTry}</span>
      </div>
      <div className="practice-body no-side">
        <div className="canvas-wrap">
          <PianoCanvas scene={scene} />
          <div className="overlay" style={{ background: 'transparent', backdropFilter: 'none', placeItems: 'start center', pointerEvents: 'none' }}>
            <div className="card col" style={{ gap: 14, pointerEvents: 'auto', marginTop: 24 }}>
              {status === 'done' ? (
                <>
                  <h1>Ear training complete <Stars n={firstTry / phrases.length >= 0.9 ? 3 : firstTry / phrases.length >= 0.7 ? 2 : 1} /></h1>
                  <p>You found {firstTry} of {phrases.length} phrases on the first try. Ear training gets faster with short, frequent sessions – come back tomorrow and it will feel easier.</p>
                  <div className="row">
                    <button className="btn" onClick={() => { setI(0); setFirstTry(0); triesRef.current = 0; setStatus('intro') }}>Again</button>
                    {onNext && <button className="btn primary" onClick={onNext}>Next lesson →</button>}
                  </div>
                </>
              ) : i === 0 && status === 'intro' ? (
                <>
                  <h1>{lesson.title}</h1>
                  <p style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{lesson.goal}</p>
                  {lesson.intro.map((p, k) => <p key={k}>{p}</p>)}
                  <p className="sub">The first note is always shown. Find the rest by ear – trial and error is part of it.</p>
                  <button className="btn primary" onClick={() => void listen()} autoFocus>▶ Play the first phrase</button>
                </>
              ) : (
                <>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h2>{status === 'listen' ? 'Listen…' : status === 'right' ? 'Correct!' : status === 'wrong' ? 'Not quite – start the phrase again' : 'Your turn – play it back'}</h2>
                    <span className="sub">{phrase.length} notes · starts on <b>{noteNameOct(phrase[0])}</b></span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {phrase.map((p, k) => (
                      <div key={k} className="note-chip" style={{ borderBottom: `3px solid ${k < played.length ? 'var(--ok)' : 'transparent'}` }}>
                        <b>{k === 0 || k < played.length || status === 'right' ? noteName(p) : '?'}</b>
                        <span>{k > 0 && (k < played.length || status === 'right') ? intervalName(p - phrase[k - 1]) + (p > phrase[k - 1] ? ' up' : p < phrase[k - 1] ? ' down' : '') : k === 0 ? 'start' : ''}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => void listen()}>↺ Hear it again</button>
                    {status !== 'right' && <button className="btn ghost" onClick={() => setHint(true)}>Show next key</button>}
                    <span className="spacer" />
                    {status === 'right' && <button className="btn primary" onClick={nextPhrase} autoFocus>{i + 1 >= phrases.length ? 'Finish' : 'Next phrase →'}</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
