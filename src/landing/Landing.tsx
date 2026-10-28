import { lazy, Suspense, useState } from 'react'
import { Mascot } from '../ui/Mascot'

const Demo = lazy(() => import('./Demo'))

// shortcut: no form yet; paste the Tally share link here once the form exists, and the button opens it.
const SIGNUP_URL = ''

const FEATURES = [
  ['5 practice modes', 'Watch, Wait, Rhythm, Loop, Free'],
  ['39 lessons in 8 stages', 'Every one fits 25 keys'],
  ['Pads, knobs, chord names', 'Uses the whole controller'],
]
const FAQ = [
  ['Do I need a MIDI keyboard?', 'No. Laptop keys and touch work, so you can try everything first. A MIDI keyboard turns it into real piano practice.'],
  ['Which browsers?', 'Chrome or Edge on Windows, Mac, Linux or Android. iPhone and iPad can’t connect a MIDI keyboard yet, because Safari has no Web MIDI.'],
  ['Is it really free?', 'Yes. Everything is free during the beta, and founding testers get the later premium version free for life.'],
  ['Does it work offline?', 'Yes, once installed: use “Install app” in the browser menu.'],
  ['What data do you keep?', 'There are no accounts. Your progress and settings stay in your browser.'],
]

export function Landing() {
  const [demo, setDemo] = useState(false)
  const play = () => {
    setDemo(true)
    // Wait a frame so the demo's frame exists before scrolling to it.
    requestAnimationFrame(() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const toBeta = () => document.getElementById('beta')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="landing-page">
      <header className="hero">
        <div className="row hero-brand"><Mascot size={44} /><b>Mochi MIDI</b></div>
        <h1>Learn piano on your small MIDI keyboard. Free, in your browser.</h1>
        <p className="lede">No account, nothing to install, works offline. Made for 25-key controllers like the Arturia MiniLab 3.</p>
        <div className="row hero-actions">
          <button className="btn primary" onClick={play}>▶ Play the 30-second demo</button>
          <a className="btn" href="../">Open the app</a>
        </div>
      </header>

      <section id="demo" className="demo">
        {demo ? (
          <Suspense fallback={<div className="demo-frame demo-poster"><p className="sub">Loading the piano…</p></div>}>
            <Demo onExit={() => setDemo(false)} />
          </Suspense>
        ) : (
          <div className="demo-frame demo-poster">
            <Mascot size={72} />
            <h2>Your first tune: Hot Cross Buns</h2>
            <p className="sub">Three notes, right hand. Play it with laptop keys, by touch, or on your MIDI keyboard.</p>
            <button className="btn primary" onClick={play}>▶ Play the demo</button>
          </div>
        )}
        <div className="demo-cta">
          <span>Liked it? There are 38 more lessons.</span>
          <button className="btn primary small" onClick={toBeta}>Get the full beta ↓</button>
        </div>
      </section>

      <section className="features">
        {FEATURES.map(([name, line]) => <div key={name} className="card feature"><h3>{name}</h3><p className="sub">{line}</p></div>)}
      </section>

      <section className="card works-with">
        <h2>Lessons for the MiniLab 3 and other 25-key keyboards</h2>
        <p>Arturia MiniLab 3 · Novation Launchkey Mini · Akai MPK Mini · any USB MIDI keyboard · laptop keys · touch</p>
        <p className="sub">The pads play drums, the knobs and faders shape the sound, and the touch strips bend notes, all inside the lessons. There's a small studio to record and export MIDI, and harmonium, drones and chant lessons for kirtan.</p>
      </section>

      <section id="beta" className="card beta">
        <h2>Join the beta</h2>
        <p>We're looking for people who will play three times a week for a month and say where it breaks or bores them. You'll get the beta link and short update notes, nothing else.</p>
        {SIGNUP_URL
          ? <a className="btn primary" href={SIGNUP_URL} target="_blank" rel="noopener">Join the beta</a>
          : <p className="sub">The sign-up form opens soon. Until then, the whole app is free to use: <a href="../">open it here</a>.</p>}
      </section>

      <section className="faq">
        <h2>Questions</h2>
        {FAQ.map(([q, a]) => <details key={q} className="card"><summary>{q}</summary><p>{a}</p></details>)}
      </section>

      <footer className="landing-foot sub">
        <a href="../privacy.html">Privacy</a> · <a href="https://github.com/edenspec2/mochimidi" target="_blank" rel="noopener">GitHub</a> · Piano samples: Salamander Grand Piano (CC-BY 3.0, Alexander Holm)
      </footer>
    </div>
  )
}
