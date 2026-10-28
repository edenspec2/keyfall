import { useEffect } from 'react'
import { audio } from '../audio/audioEngine'
import { CURRICULUM } from '../lessons/curriculum'
import { midi } from '../midi/midiInput'
import { setRenderTheme } from '../render/pianoRenderer'
import { useMidiStatus } from '../ui/hooks'
import { initLiveInput } from '../ui/live'
import { Practice } from '../ui/Practice'
import { MidiStatusPill } from '../ui/Settings'

/** The app's own lesson screen with lesson 1, loaded only when a visitor asks for it (it brings the audio engine). */
export default function Demo({ onExit }: { onExit: () => void }) {
  const m = useMidiStatus()
  useEffect(() => {
    setRenderTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    initLiveInput() // laptop keys, touch and MIDI all arrive through the same input as in the app
    audio.preloadPiano()
  }, [])
  return (
    <>
      <div className="demo-frame">
        {/* Lesson 1 is the demo, so a visitor's run is saved as real progress (the page shares the app's storage).
            Its "Next lesson" button continues in the full app. */}
        <Practice lesson={CURRICULUM[0]} onExit={onExit} onNext={() => { location.href = '../' }} />
      </div>
      <div className="demo-help">
        <span className="sub">Laptop: <kbd>A</kbd> = C, <kbd>S</kbd> = D, <kbd>D</kbd> = E. Phone: tap the keys.</span>
        <span className="spacer" />
        {m.status === 'ready' || m.status === 'unsupported'
          ? <MidiStatusPill />
          : <button className="btn small" onClick={() => void midi.connect()}>Use my MIDI keyboard</button>}
      </div>
    </>
  )
}
