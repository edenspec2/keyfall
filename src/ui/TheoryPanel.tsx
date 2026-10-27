import { useRef } from 'react'
import { identifyChord, intervalName, noteName, noteNameOct, parseKey, pc, romanNumeral, scalePcs, SCALES } from '../music/theory'
import { useHeld } from './hooks'

/**
 * Explains what is under the player's fingers: notes, the interval or chord they form,
 * why it sounds the way it does, and how it fits the current key.
 */
export function TheoryPanel({ musicalKey }: { musicalKey?: string }) {
  const held = useHeld()
  const last = useRef<number[]>([])
  if (held.length) last.current = held
  const shown = held.length ? held : last.current
  const key = musicalKey ? parseKey(musicalKey) : null
  const keyPcs = key ? scalePcs(key.root, key.minor ? 'natural minor' : 'major') : null
  const chord = shown.length >= 2 ? identifyChord(shown) : null

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>What you're playing</h3>
        {musicalKey && <span className="pill">Key: {musicalKey}</span>}
      </div>
      {!shown.length && <p className="sub">Play a note or chord – I'll explain it here.</p>}
      {shown.length > 0 && (
        <div className="row" style={{ gap: 6, opacity: held.length ? 1 : 0.55 }}>
          {shown.map((p) => (
            <div className="note-chip" key={p}>
              <b>{noteName(p)}</b>
              <span>{noteNameOct(p)}{keyPcs && !keyPcs.includes(pc(p)) ? ' · outside key' : ''}</span>
            </div>
          ))}
        </div>
      )}
      {shown.length === 1 && keyPcs && keyPcs.includes(pc(shown[0])) && key && (
        <p className="sub">{noteName(shown[0])} is degree {keyPcs.indexOf(pc(shown[0])) + 1} of {musicalKey}.</p>
      )}
      {shown.length === 2 && (
        <div className="callout">
          <b>{intervalName(shown[1] - shown[0])}</b> ({shown[1] - shown[0]} half steps)
          <p className="sub" style={{ marginTop: 4 }}>{INTERVAL_FEEL[Math.min(12, shown[1] - shown[0])]}</p>
        </div>
      )}
      {chord && shown.length >= 3 && (
        <div className="callout">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: '1.3rem' }}>{chord.name}</b>
            <span className="sub">{chord.quality} · {chord.inversion}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {chord.tones.map((t) => <div key={t.pitch} className="row" style={{ justifyContent: 'space-between' }}><span>{t.name}</span><span className="sub">{t.role}</span></div>)}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>{chord.why}</p>
          {key && (() => {
            const rn = romanNumeral(key.root, key.minor, chord.root, chord.quality)
            return <p style={{ marginTop: 8 }}>{rn ? <>In {musicalKey} this is the <b>{rn}</b> chord.</> : <>This chord borrows notes from outside {musicalKey}.</>}</p>
          })()}
          <p className="sub" style={{ marginTop: 8 }}>
            To transpose it, keep the same shape and move every finger by the same number of keys –
            e.g. {chord.name} up a whole step is {noteName((chord.root + 2) % 12)}{chord.name.replace(/^[A-G][♯♭]?/, '').replace(/\/.*/, '')}.
          </p>
        </div>
      )}
      {shown.length >= 3 && !chord && <p className="sub">Not a standard chord – a cluster or partial voicing. Try removing a note.</p>}
      {key && (
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>Notes of {musicalKey}</p>
          <div className="row" style={{ gap: 4 }}>
            {(keyPcs ?? []).map((p, i) => <span key={p} className={`pill${shown.some((h) => pc(h) === p) ? ' key-pill' : ''}`}>{i + 1}·{noteName(p)}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

const INTERVAL_FEEL = [
  'The same note twice.',
  'Very close and tense – think of the Jaws theme.',
  'A step of a scale – the building block of melodies.',
  'Dark, sad colour – the sound of a minor chord.',
  'Bright and happy – the sound of a major chord.',
  'Open and strong, like "Here Comes the Bride".',
  'The "devil\'s interval" – restless, wants to resolve.',
  'Very stable and open – the backbone of most chords.',
  'Bittersweet – a minor chord turned upside down.',
  'Warm and sweet – the opening of "My Bonnie".',
  'Bluesy tension – the 7th in a dominant chord.',
  'Dreamy and close to the octave – wants to rise.',
  'Same note name, higher – sounds like one note doubled.',
]

export const SCALE_NAMES = Object.keys(SCALES)
