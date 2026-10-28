import { useEffect, useState } from 'react'
import { audio } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'
import { noteNameOct } from '../music/theory'
import { settings } from '../store/store'
import { useMidiStatus } from './hooks'
import { MidiDiagnostics } from './Settings'
import { Mascot } from './Mascot'

const STEPS = ['Connect', 'Choose input', 'Test keys', 'Sound', 'Timing', 'Play']

export function Onboarding({ done }: { done: (startLesson: boolean) => void }) {
  const [step, setStep] = useState(0)
  const m = useMidiStatus()
  const [pressed, setPressed] = useState<number[]>([])
  const [lowest, setLowest] = useState<number | null>(settings.get().lowestKey)
  const [askLowest, setAskLowest] = useState(false)

  useEffect(() => midi.on((e) => {
    if (e.type !== 'on') return
    setPressed((p) => [...p, e.pitch].slice(-8))
    if (askLowest) { setLowest(e.pitch); settings.set({ lowestKey: e.pitch }); setAskLowest(false) }
  }), [askLowest])

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const enableSound = async () => {
    await audio.start()
    audio.setVolume(settings.get().volume)
    const t = audio.now() + 0.05
    ;[60, 64, 67, 72].forEach((p, i) => audio.schedule(p, t + i * 0.16, 0.9, 80))
  }

  return (
    <div className="page" style={{ maxWidth: 760, paddingTop: 48 }}>
      <div className="row welcome" style={{ gap: 14 }}><Mascot size={52} /><h1>Welcome to Mochi MIDI</h1></div>
      <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>{STEPS.map((s, i) => <div key={s} className={i <= step ? 'done' : ''} title={s} />)}</div>

      <div className="card col step-card" key={step} style={{ gap: 16, padding: 28 }}>
        {step === 0 && <>
          <h2>1 · Connect your MiniLab 3</h2>
          <p>Plug the MiniLab into a USB port and click <b>Connect</b>. Your browser will ask for permission to use MIDI devices – allow it.</p>
          <p className="sub">Close Arturia MIDI Control Center, Analog Lab or any DAW first: on Windows only one program can listen to the keyboard at a time.</p>
          <div className="row">
            <button className="btn primary" onClick={async () => { await midi.connect(); if (midi.status === 'ready') next() }} autoFocus>Connect</button>
            <button className="btn ghost" onClick={() => { setStep(3) }}>I don't have a keyboard right now (use the computer keys)</button>
          </div>
          {m.status === 'denied' && <div className="callout bad">MIDI permission was blocked. Click the icon left of the address bar → Site settings → allow MIDI devices, then try again.</div>}
          {m.status === 'unsupported' && <div className="callout bad">This browser can't read MIDI. Please open the app in Chrome or Edge.</div>}
        </>}

        {step === 1 && <>
          <h2>2 · Choose the input</h2>
          <p>{m.connectedCount ? <>Found {m.connectedCount} MIDI input{m.connectedCount > 1 ? 's' : ''}. The MiniLab shows up as several ports; <b>Automatic</b> picks the right one. Press a few keys and watch the log.</> : <>No MIDI keyboard found yet. Check the USB cable, then click <b>Rescan devices</b>.</>}</p>
          <MidiDiagnostics />
          <div className="row"><button className="btn primary" onClick={next} disabled={!m.connectedCount}>Next</button><button className="btn ghost" onClick={next}>Skip</button></div>
        </>}

        {step === 2 && <>
          <h2>3 · Test a few keys</h2>
          <p>Play any three keys. You should see their names here.</p>
          <div className="row" style={{ minHeight: 64 }}>{pressed.map((p, i) => <div className="note-chip" key={i}><b>{noteNameOct(p)}</b><span>note {p}</span></div>)}</div>
          <div className="callout">
            Now press the <b>lowest key</b> (far left) of your keyboard so lessons can tell you when to use the octave buttons.
            <div className="row" style={{ marginTop: 8 }}>
              <button className={`btn small ${askLowest ? 'on' : ''}`} onClick={() => setAskLowest(true)}>{askLowest ? 'Waiting for your lowest key…' : 'Detect lowest key'}</button>
              {lowest !== null && <span>Lowest key: <b>{noteNameOct(lowest)}</b> {lowest === 48 ? '– default octave, perfect for the lessons.' : lowest < 48 ? `– press Oct + ${(48 - lowest) / 12}× to match the lessons.` : `– press Oct − ${(lowest - 48) / 12}× to match the lessons.`}</span>}
            </div>
          </div>
          <div className="row"><button className="btn primary" onClick={next} disabled={pressed.length < 3}>Next</button><button className="btn ghost" onClick={next}>Skip</button></div>
        </>}

        {step === 3 && <>
          <h2>4 · Check the sound</h2>
          <p>Your MiniLab makes no sound itself – the app plays a sampled grand piano through your computer. Click below, then play a few keys.</p>
          <p className="sub">Use wired headphones or speakers. Bluetooth headphones add a delay you will feel when playing.</p>
          <div className="row">
            <button className="btn primary" onClick={() => void enableSound()} autoFocus>🔊 Play a test chord</button>
            <button className="btn" onClick={next}>I hear it</button>
          </div>
          <details><summary className="sub" style={{ cursor: 'pointer' }}>No sound?</summary>
            <ul className="sub"><li>Check the Windows volume and the output device (speaker icon in the taskbar).</li><li>Make sure this browser tab isn't muted (right-click the tab).</li><li>Click the test button again – browsers only allow sound after a click.</li></ul>
          </details>
        </>}

        {step === 4 && <>
          <h2>5 · Timing</h2>
          <p>The app measures your audio delay automatically, so most people can skip this. If notes ever feel graded "late" when they sounded right, run the tap test in <b>Settings → Timing calibration</b>.</p>
          <div className="row"><button className="btn primary" onClick={next} autoFocus>Next</button></div>
        </>}

        {step === 5 && <>
          <h2>6 · Your first tune</h2>
          <p>You'll play <b>Hot Cross Buns</b> with three fingers around middle C. The notes fall toward the keys; in <b>Wait mode</b> the music pauses until you press the right key, so take your time.</p>
          <p className="sub">Tip: <span className="kbd">Space</span> plays and pauses. Blue notes are for the right hand, orange for the left.</p>
          <div className="row">
            <button className="btn primary" onClick={() => { void audio.start(); settings.set({ onboarded: true }); done(true) }} autoFocus>Start my first lesson</button>
            <button className="btn ghost" onClick={() => { settings.set({ onboarded: true }); done(false) }}>Look around first</button>
          </div>
        </>}
      </div>
      {step > 0 && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(step - 1)}>← Back</button>}
    </div>
  )
}
