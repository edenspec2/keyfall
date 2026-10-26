import { useState } from 'react'
import { audio } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'
import { guessKey, identifyChord, noteName, pc, SCALES, scalePcs, SHARP_NAMES } from '../music/theory'
import { displayRange, type Scene } from '../render/pianoRenderer'
import { settings, useStore } from '../store/store'
import { useHeld } from './hooks'
import { padHits, trails } from './live'
import { PianoCanvas } from './PianoCanvas'
import { deviceRange } from './Practice'
import { SoundPanel } from './SoundPanel'
import { TheoryPanel } from './TheoryPanel'

const CHORD_TYPES: { id: string; label: string; iv: number[] }[] = [
  { id: '', label: 'Major', iv: [0, 4, 7] },
  { id: 'm', label: 'Minor', iv: [0, 3, 7] },
  { id: 'dim', label: 'Diminished', iv: [0, 3, 6] },
  { id: 'sus4', label: 'Sus4', iv: [0, 5, 7] },
  { id: '7', label: 'Dominant 7', iv: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Major 7', iv: [0, 4, 7, 11] },
  { id: 'm7', label: 'Minor 7', iv: [0, 3, 7, 10] },
]

/** Chord in inversion `inv`, stacked from the root near middle C and kept inside C3–C5 (48–72). */
export function voicing(root: number, iv: number[], inv: number): number[] {
  const v = iv.map((i) => 60 + root - (root > 6 ? 12 : 0) + i)
  for (let k = 0; k < inv; k++) v.push(v.shift()! + 12)
  let shift = 0
  while (Math.max(...v) + shift > 72) shift -= 12
  while (Math.min(...v) + shift < 48) shift += 12
  return v.map((p) => p + shift)
}

export function Explore() {
  const st = useStore(settings)
  const held = useHeld()
  const [root, setRoot] = useState(0)
  const [scale, setScale] = useState('major')
  const [showScale, setShowScale] = useState(true)
  const [chordType, setChordType] = useState(0)
  const [inv, setInv] = useState(0)
  const [lit, setLit] = useState<number[]>([])
  const [dlo, dhi] = deviceRange()
  const range = displayRange(dlo, dhi)
  const scaleSet = scalePcs(root, scale)

  const play = async (pitches: number[], arpeggio = false) => {
    await audio.start()
    const t = audio.now() + 0.05
    pitches.forEach((p, i) => audio.schedule(p, t + (arpeggio ? i * 0.22 : 0), arpeggio ? 0.4 : 1.4, 78))
    setLit(pitches)
    setTimeout(() => setLit([]), (arpeggio ? pitches.length * 220 : 0) + 1400)
  }
  const scaleNotes = () => {
    const base = 60 + root - (root > 6 ? 12 : 0)
    const up = [...SCALES[scale].map((i) => base + i), base + 12]
    return up
  }
  const chord = voicing(root, CHORD_TYPES[chordType].iv, inv)
  const chordInfo = identifyChord(chord)

  const scene = (): Scene => ({
    beat: 0, notes: [], userHands: 'none', range, held: midi.held, labels: st.labels, beatsVisible: 6, beatsPerBar: 4, trails,
    highlightPcs: showScale ? scaleSet : undefined, pending: lit, pads: true, padHits,
  })
  const heldKey = guessKey([...new Set(held.map(pc))])

  return (
    <div className="practice">
      <div className="practice-bar">
        <b>Explore</b>
        <span className="sub">Play freely – the panel explains every note and chord.</span>
        <span className="spacer" />
        {heldKey && held.length >= 3 && <span className="pill">These notes fit {heldKey}</span>}
      </div>
      <div className="practice-body">
        <div style={{ display: 'grid', gridTemplateRows: 'minmax(260px, 1fr) auto', minHeight: 0 }}>
          <div className="canvas-wrap"><PianoCanvas scene={scene} /></div>
          <div className="row" style={{ padding: 16, gap: 16, alignItems: 'stretch', borderTop: '1px solid var(--line)', overflow: 'auto' }}>
            <div className="card col" style={{ flex: 1, minWidth: 260 }}>
              <h3>Scales</h3>
              <div className="row">
                <select value={root} onChange={(e) => setRoot(+e.target.value)} aria-label="Root">{SHARP_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
                <select value={scale} onChange={(e) => setScale(e.target.value)} aria-label="Scale">{Object.keys(SCALES).map((s) => <option key={s}>{s}</option>)}</select>
                <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={showScale} onChange={(e) => setShowScale(e.target.checked)} /> Show on keys</label>
              </div>
              <p className="sub">{scaleSet.map((p) => noteName(p)).join(' · ')}</p>
              <p className="sub" style={{ fontSize: '0.85rem' }}>Steps: {SCALES[scale].concat(12).slice(1).map((v, i) => (v - SCALES[scale].concat(12)[i] === 1 ? 'H' : v - SCALES[scale].concat(12)[i] === 2 ? 'W' : `${v - SCALES[scale].concat(12)[i]}`)).join(' ')} (W = whole step, H = half step)</p>
              <div className="row"><button className="btn small" onClick={() => void play(scaleNotes(), true)}>▶ Hear it</button></div>
            </div>
            <div className="card col" style={{ flex: 1, minWidth: 260 }}>
              <h3>Chord builder</h3>
              <div className="row">
                <select value={root} onChange={(e) => setRoot(+e.target.value)} aria-label="Chord root">{SHARP_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
                <select value={chordType} onChange={(e) => { setChordType(+e.target.value); setInv(0) }} aria-label="Chord type">{CHORD_TYPES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}</select>
              </div>
              <div className="seg">{CHORD_TYPES[chordType].iv.map((_, i) => <button key={i} className={inv === i ? 'active' : ''} onClick={() => setInv(i)}>{i === 0 ? 'Root' : `Inv ${i}`}</button>)}</div>
              <p><b>{chordInfo?.name ?? ''}</b> <span className="sub">{chord.map((p) => noteName(p)).join(' – ')}{chordInfo ? ` · ${chordInfo.inversion}` : ''}</span></p>
              <div className="row"><button className="btn small" onClick={() => void play(chord)}>▶ Play</button><button className="btn small" onClick={() => void play(chord, true)}>Arpeggio</button><span className="sub" style={{ fontSize: '0.8rem' }}>Yellow keys show where to put your fingers.</span></div>
            </div>
          </div>
        </div>
        <aside className="side"><TheoryPanel musicalKey={`${SHARP_NAMES[root]} ${/minor|blues|dorian/.test(scale) ? 'minor' : 'major'}`} /><SoundPanel compact /></aside>
      </div>
    </div>
  )
}
