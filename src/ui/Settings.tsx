import { useEffect, useRef, useState } from 'react'
import { audio, ENGINE_KEY, INSTRUMENTS, type InstrumentId } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'
import { noteNameOct } from '../music/theory'
import { progress, settings, useStore } from '../store/store'
import { GOATCOUNTER, setStatsAllowed, statsAllowed } from '../analytics'
import { useMidiStatus, useTicker } from './hooks'

export function MidiStatusPill() {
  const m = useMidiStatus()
  useTicker(500)
  const active = m.inputs.find((i) => i.id === m.activePort)
  const recent = performance.now() - m.lastActivity < 600
  const [cls, text] =
    m.status === 'unsupported' ? ['bad', 'No Web MIDI (use Chrome/Edge)'] :
    m.status === 'denied' ? ['bad', 'MIDI blocked'] :
    m.status !== 'ready' ? ['', 'MIDI not connected'] :
    !m.connectedCount ? ['warn', 'No keyboard found'] :
    m.busy.size && active && m.busy.has(active.id) ? ['bad', 'Port busy'] :
    ['ok', active ? active.name : `${m.connectedCount} inputs`]
  return <span className="pill" title={text}><span className={`dot ${cls}`} style={recent ? { transform: 'scale(1.5)' } : undefined} /><span>{text}</span></span>
}

/** Live MIDI message log + device picker. Used in Settings and onboarding. */
export function MidiDiagnostics() {
  const m = useMidiStatus()
  const st = useStore(settings)
  useTicker(150)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo(0, 1e9) })
  const silentFor = m.status === 'ready' && m.connectedCount > 0 && m.log.length === 0

  return (
    <div className="col">
      <div className="row">
        {m.status !== 'ready' && <button className="btn primary" onClick={() => void midi.connect()}>Connect MIDI</button>}
        {m.status === 'ready' && <button className="btn small" onClick={() => midi.refresh()}>Rescan devices</button>}
        <label className="field">Input
          <select value={st.midiPort} onChange={(e) => settings.set({ midiPort: e.target.value })}>
            <option value="auto">Automatic{m.status === 'ready' ? ` (${m.inputs.find((i) => i.id === m.suggestPort())?.name ?? 'all inputs'})` : ''}</option>
            <option value="all">All inputs</option>
            {m.inputs.map((i) => <option key={i.id} value={i.id}>{i.name}{i.state !== 'connected' ? ' (disconnected)' : ''}{m.busy.has(i.id) ? ' (busy)' : ''}</option>)}
          </select>
        </label>
        <label className="field">Channel
          <select value={st.midiChannel} onChange={(e) => settings.set({ midiChannel: +e.target.value })}>
            <option value={0}>Any (omni)</option>
            {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <label className="field">Pads (channel 10)
          <select value={st.padMode} onChange={(e) => settings.set({ padMode: e.target.value as typeof st.padMode })}>
            <option value="drums">Drum kit</option>
            <option value="ignore">Ignore</option>
            <option value="notes">Piano notes</option>
          </select>
        </label>
        <PadLearn />
      </div>
      {m.status === 'denied' && <div className="callout bad">The browser blocked MIDI access ({m.error}). Click the icon left of the address bar → Site settings → allow <b>MIDI devices</b>, then reload.</div>}
      {m.status === 'unsupported' && <div className="callout bad">This browser has no Web MIDI. Open the app in <b>Chrome</b> or <b>Edge</b>.</div>}
      {[...m.busy].length > 0 && <div className="callout bad">A port could not be opened – another program is using it. Close Arturia MIDI Control Center, Analog Lab or your DAW, then click <b>Rescan devices</b>.</div>}
      {silentFor && <div className="callout warn">Devices are listed but no messages have arrived yet. Press a key. If nothing shows up, another program may be holding the MiniLab (see above), or the cable/USB hub may be the problem.</div>}
      <div className="log mono" ref={logRef} aria-live="off">
        {m.log.length === 0 && <span className="sub">Incoming MIDI messages appear here.</span>}
        {m.log.map((e, i) => (
          <div key={i}><span className="sub">{(e.t / 1000).toFixed(3)}s</span> &nbsp;<span style={{ color: 'var(--accent-2)' }}>{e.port}</span> &nbsp;{e.text}{/note (\d+)/.test(e.text) ? <span className="sub"> ({noteNameOct(+e.text.match(/note (\d+)/)![1])})</span> : null} <span className="sub">[{e.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}]</span></div>
        ))}
      </div>
      <details>
        <summary className="sub" style={{ cursor: 'pointer' }}>Troubleshooting the MiniLab 3</summary>
        <ul className="sub">
          <li>Use the port called <b>Minilab3 MIDI</b>. The <i>MIDIIN2/3/4</i> ports carry DAW buttons and are ignored in Automatic mode.</li>
          <li>Notes are an octave off? Press <b>Oct −/+</b> until the octave LEDs are off (default octave: lowest key sends C3 = note 48).</li>
          <li>Extra or stuck notes? Turn off <b>Arp</b>, <b>Chord</b> and <b>Hold</b> on the MiniLab.</li>
          <li>Nothing arrives? Only one program can use the MiniLab on Windows. Close MIDI Control Center / Analog Lab / DAWs.</li>
          <li>Sustain pedal: plug it into the jack on the back; it sends CC 64 and works here.</li>
          <li>Pads play a drum kit (Kick, Snare, Closed hat, Open hat, Clap, Low tom, High tom, Crash). If the wrong drum sounds, use <b>Detect pad 1</b>. On the computer, keys <span className="kbd">1</span>–<span className="kbd">8</span> are the pads.</li>
          <li>Touch strips: the pitch strip bends and the mod strip adds vibrato on the <b>Synth lead</b>, <b>Electric piano</b> and <b>Strings</b> sounds (a grand piano can't bend).</li>
          <li>Use wired headphones or speakers – Bluetooth adds 150–250 ms of delay that no setting can remove.</li>
        </ul>
      </details>
    </div>
  )
}

/** "Detect pad 1": the next channel-10 note sets which note number is pad 1. */
function PadLearn() {
  const st = useStore(settings)
  const [waiting, setWaiting] = useState(false)
  return (
    <label className="field">Pad 1 = note {st.padBase}
      <button className={`btn small ${waiting ? 'on' : ''}`} onClick={() => {
        setWaiting(true)
        midi.onPadLearn = (note) => { settings.set({ padBase: note }); setWaiting(false) }
      }}>{waiting ? 'Hit pad 1…' : 'Detect pad 1'}</button>
    </label>
  )
}

/** Tap along to 16 clicks; the median offset becomes the timing calibration. */
/**
 * Audio status plus a beep that bypasses the whole sound engine. If the beep is heard but notes are not, the app is at
 * fault; if neither is heard, the phone's output is (volume, or Android sending audio to the USB keyboard).
 */
/** Full or light sound engine. Light (default on phones) skips reverb, chorus, delay and the widener to spare the CPU. */
function EngineChoice() {
  const read = () => { try { return localStorage.getItem(ENGINE_KEY) ?? 'auto' } catch { return 'auto' } }
  const [pick, setPick] = useState(read)
  const set = (v: string) => { try { localStorage.setItem(ENGINE_KEY, v) } catch { /* blocked */ } setPick(v) }
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <span className="sub">Sound engine</span>
        <div className="seg" role="radiogroup" aria-label="Sound engine">
          {(['auto', 'light', 'full'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={pick === v} className={pick === v ? 'active' : ''} onClick={() => set(v)}>{v === 'auto' ? 'Auto' : v === 'light' ? 'Light' : 'Full'}</button>
          ))}
        </div>
      </div>
      <span className="sub" style={{ fontSize: 'var(--fs-sm)' }}>Light skips reverb, chorus, delay and stereo effects and draws more simply, so phones don't stutter or go silent. Auto = light on phones. Reload the page after changing it.</span>
    </div>
  )
}

function AudioCheck() {
  useTicker(500)
  const [check, setCheck] = useState('')
  const [result, setResult] = useState('')
  const runCheck = async () => {
    setResult('')
    setCheck('1 of 3: plain browser beep')
    beep()
    await new Promise((r) => setTimeout(r, 900))
    try {
      const r = await audio.selfTest(setCheck)
      setResult(`clock ${r.clock ? 'moving' : 'STUCK'} · ${r.state} · ${r.rate} Hz · Tone direct ${r.direct} · app path ${r.chain}`)
    } catch (err) { setResult(`error: ${err}`) }
    setCheck('')
  }
  const beep = () => {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const c = new C()
    const o = c.createOscillator(), g = c.createGain()
    o.frequency.value = 660
    g.gain.setValueAtTime(0.25, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5)
    o.connect(g).connect(c.destination)
    void c.resume().then(() => { o.start(); o.stop(c.currentTime + 0.5); setTimeout(() => void c.close(), 900) })
  }
  return (
    <div className="col" style={{ gap: 6 }}>
      <p className="sub">Audio: <b className="mono">{audio.status()}</b>{audio.lastError && <><br />Last error: <span className="mono">{audio.lastError}</span></>}</p>
      <div className="row">
        <button className="btn small" onClick={beep}>Direct test beep</button>
        <button className="btn small primary" onClick={() => void runCheck()} disabled={!!check}>{check ? 'Checking…' : 'Run sound check'}</button>
        <span className="sub" style={{ fontSize: 'var(--fs-sm)' }}>No beep either? Turn up the media volume, and on Android try unplugging the keyboard: some phones send all sound to a USB device.</span>
      </div>
      <EngineChoice />
      {check && <p className="callout">{check} – listen…</p>}
      {result && <p className="callout mono" style={{ userSelect: 'all' }}>{result}<br /><span className="sub">Which of the 3 beeps did you hear? Send this line and your answer.</span></p>}
    </div>
  )
}

function Calibration() {
  const st = useStore(settings)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<number | null>(null)
  const run = async () => {
    await audio.start()
    const bpm = 90, spb = 60 / bpm, t0 = audio.now() + 0.5
    const clicks = Array.from({ length: 16 }, (_, i) => t0 + i * spb)
    clicks.forEach((t, i) => audio.metronome(t, i % 4 === 0))
    const offsets: number[] = []
    setPhase('running')
    const off = midi.on((e) => {
      if (e.type !== 'on') return
      const t = audio.heard(e.time)
      const nearest = clicks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))
      if (clicks.indexOf(nearest) >= 4 && Math.abs(t - nearest) < spb / 2) offsets.push(t - nearest)
    })
    setTimeout(() => {
      off()
      offsets.sort((a, b) => a - b)
      const med = offsets.length >= 5 ? offsets[Math.floor(offsets.length / 2)] : null
      setResult(med === null ? null : Math.round(med * 1000))
      setPhase('done')
    }, (clicks[15] - audio.now() + 0.6) * 1000)
  }
  return (
    <div className="col">
      <p className="sub">Tap any key exactly on each click (16 clicks; the first 4 are a warm-up). The app measures how late you hear the sound and corrects scoring for it. Current offset: <b>{st.calibrationMs} ms</b>. Measured output latency: {Math.round(audio.started ? audio.outputLatency * 1000 : 0)} ms (already handled automatically).</p>
      <div className="row">
        <button className="btn" onClick={() => void run()} disabled={phase === 'running'}>{phase === 'running' ? 'Tap along…' : 'Start tap test'}</button>
        <label className="row" style={{ gap: 6 }}>Manual offset
          <input type="number" value={st.calibrationMs} step={5} style={{ width: 80 }} onChange={(e) => settings.set({ calibrationMs: +e.target.value })} /> ms
        </label>
      </div>
      {phase === 'done' && (result === null
        ? <div className="callout warn">Not enough taps were detected. Try again and tap with every click.</div>
        : <div className="callout">Your taps landed {Math.abs(result)} ms {result >= 0 ? 'after' : 'before'} the click on average. {Math.abs(result) <= 20 ? 'That is excellent – no correction needed.' : ''}
          <div className="row" style={{ marginTop: 8 }}><button className="btn small primary" onClick={() => settings.set({ calibrationMs: Math.abs(result) <= 20 ? 0 : result })}>Use {Math.abs(result) <= 20 ? 0 : result} ms</button></div></div>)}
    </div>
  )
}

/** The beta feedback form (Tally or Google Forms); '' hides the button. */
const FEEDBACK_URL = 'https://tally.so/r/gbbOg1'

/** Feedback, privacy and credits. The piano samples are CC BY 3.0, which requires this visible credit. */
function About() {
  const [stats, setStats] = useState(statsAllowed)
  return (
    <div className="col" style={{ gap: 10 }}>
      {FEEDBACK_URL && <div className="row"><a className="btn small primary" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">Send feedback</a><span className="sub">Found a bug, or something confusing? Tell us – it takes a minute.</span></div>}
      <p className="sub">No account and no ads. Your progress, songs and settings stay on this device. <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener">Privacy policy</a></p>
      {GOATCOUNTER && (
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={stats} onChange={(e) => { setStatsAllowed(e.target.checked); setStats(e.target.checked) }} />
          Send anonymous usage counts (which lessons are started and passed, and whether the sound failed). Nothing about you.
        </label>
      )}
      <h3 style={{ margin: '6px 0 0' }}>Credits</h3>
      <p className="sub">
        Piano: <a href="https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html" target="_blank" rel="noopener">Salamander Grand Piano V3</a> by Alexander Holm,
        licensed <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>. Changed for this app: three
        velocity layers chosen, trimmed, level-matched and re-encoded.
        Audio engine: <a href="https://tonejs.github.io/" target="_blank" rel="noopener">Tone.js</a> (MIT). Interface: React (MIT).
      </p>
    </div>
  )
}

export function Settings({ rerunSetup }: { rerunSetup: () => void }) {
  const st = useStore(settings)
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="sub">MIDI, sound, display and timing.</p></div></div>
      <section className="card col"><h2>MIDI keyboard</h2><MidiDiagnostics /></section>
      <section className="card col">
        <h2>Keyboard range</h2>
        <p className="sub">Your lowest key currently plays <b>{st.lowestKey !== null ? noteNameOct(st.lowestKey) : 'unknown (assuming C3)'}</b>. Keys: {st.keyCount}. Lessons are written for C3–C5 (the MiniLab's default octave); larger keyboards work too.</p>
        <div className="row">
          <label className="field">Number of keys
            <select value={st.keyCount} onChange={(e) => settings.set({ keyCount: +e.target.value })}>
              {[25, 32, 37, 49, 61, 76, 88].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn small" style={{ marginTop: 18 }} onClick={rerunSetup}>Re-detect in setup</button>
        </div>
      </section>
      <section className="card col">
        <h2>Appearance</h2>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={st.theme === t} className={st.theme === t ? 'active' : ''} onClick={() => settings.set({ theme: t })}>{t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto'}</button>
          ))}
        </div>
        <p className="sub">Auto follows your system setting.</p>
      </section>
      <section className="card col">
        <h2>Sound</h2>
        <div className="row">
          <label className="field">Volume <input type="range" min={0} max={1} step={0.01} value={st.volume} onChange={(e) => settings.set({ volume: +e.target.value })} /></label>
          <label className="field">Instrument
            <select value={st.instrument} onChange={(e) => settings.set({ instrument: e.target.value as InstrumentId })}>
              {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>
          <label className="field" title="If you hear crackles, choose Stable. Applies after a reload.">Audio buffer
            <select value={st.audioBuffer} onChange={(e) => settings.set({ audioBuffer: e.target.value as typeof st.audioBuffer })}>
              <option value="interactive">Lowest latency</option>
              <option value="balanced">Stable (fixes crackles)</option>
            </select>
          </label>
          <button className="btn small" style={{ marginTop: 18 }} onClick={async () => { await audio.start(); audio.setVolume(st.volume); [60, 64, 67, 72].forEach((p, i) => audio.schedule(p, audio.now() + 0.05 + i * 0.18, 0.6, 80)) }}>Test sound</button>
          <span className="sub" style={{ marginTop: 18 }}>{audio.pianoFailed ? 'Piano samples missing – using a synth piano.' : audio.pianoLoaded ? 'Sampled grand piano loaded.' : audio.started ? 'Loading piano…' : ''}</span>
        </div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={st.computerKeys} onChange={(e) => settings.set({ computerKeys: e.target.checked })} /> Play with the computer keyboard too (<span className="kbd">A</span>–<span className="kbd">;</span> white keys, <span className="kbd">W E T Y U O P</span> black keys, <span className="kbd">Z</span>/<span className="kbd">X</span> octave)</label>
        <AudioCheck />
      </section>
      <section className="card col"><h2>Timing calibration</h2><Calibration /></section>
      <section className="card col">
        <h2>Learning</h2>
        <div className="row">
          <button className="btn small" onClick={rerunSetup}>Run first-time setup again</button>
          <button className="btn small danger" onClick={() => { if (confirm('Erase all lesson progress and practice history? Your compositions are kept.')) progress.set({ lessons: {}, days: {}, improvisations: 0 }) }}>Reset progress</button>
        </div>
      </section>
      <section className="card col"><h2>About</h2><About /></section>
    </div>
  )
}
