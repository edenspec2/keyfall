import { useRef, useState } from 'react'
import { audio } from '../audio/audioEngine'
import { midi } from '../midi/midiInput'
import { guessKey, identifyChord, noteName, pc, SCALES, scalePcs, SHARP_NAMES } from '../music/theory'
import type { Lesson, NoteEvent } from '../music/types'
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

// Demo playback: notes fall for DEMO_BEATS beats before they sound, so they land on the keys as you hear them.
const DEMO_SPB = 0.5, DEMO_BEATS = 4

/** The scale one octave up and back down, one note per beat. */
export function scaleRun(rootPc: number, scale: string): number[] {
  const base = rootPc === 0 ? 60 : 48 + rootPc // the full octave must fit the 25 keys (48–72)
  const up = [...SCALES[scale].map((i) => base + i), base + 12]
  return [...up, ...up.slice(0, -1).reverse()]
}

/** A chord drill: two block chords, the arpeggio up, then the block chord held. */
export function chordDrill(chord: number[]): NoteEvent[] {
  const block = (start: number, dur: number) => chord.map((pitch) => ({ pitch, start, dur, hand: 'R' as const }))
  const n = chord.length
  return [...block(0, 2), ...block(2, 2), ...chord.map((pitch, i) => ({ pitch, start: 4 + i, dur: 1, hand: 'R' as const })), ...block(4 + n, 4)]
}

export function Explore({ onPractice }: { onPractice: (l: Lesson) => void }) {
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

  const demo = useRef<{ notes: NoteEvent[]; t0: number; end: number } | null>(null)
  const play = async (pitches: number[], arpeggio = false) => {
    await audio.start()
    const notes: NoteEvent[] = pitches.map((pitch, i) => ({ pitch, start: arpeggio ? i : 0, dur: arpeggio ? 1 : 3, hand: 'R' }))
    const t0 = audio.now() + DEMO_BEATS * DEMO_SPB
    for (const n of notes) audio.schedule(n.pitch, t0 + n.start * DEMO_SPB, n.dur * DEMO_SPB * 0.95, 78)
    demo.current = { notes, t0, end: Math.max(...notes.map((n) => n.start + n.dur)) }
    setLit(arpeggio ? [] : pitches) // a block chord shows its keys; runs are already shown by the falling notes
    setTimeout(() => setLit([]), (DEMO_BEATS + demo.current.end) * DEMO_SPB * 1000)
  }
  const chord = voicing(root, CHORD_TYPES[chordType].iv, inv)
  const chordInfo = identifyChord(chord)

  const scene = (): Scene => {
    const d = demo.current
    const beat = d ? (audio.heard(performance.now()) - d.t0) / DEMO_SPB : 0
    if (d && beat > d.end + 1) demo.current = null
    return {
      beat, notes: d?.notes ?? [], userHands: 'none', range, held: midi.held, labels: st.labels, beatsVisible: DEMO_BEATS, beatsPerBar: 4, trails,
      highlightPcs: showScale ? scaleSet : undefined, pending: lit, pads: true, padHits, autoAlpha: 0.95,
    }
  }
  const key = `${SHARP_NAMES[root]} ${/minor|blues|dorian/.test(scale) ? 'minor' : 'major'}`
  const practiceScale = () => onPractice({
    id: `explore-scale-${root}-${scale}`, stage: 3, kind: 'play', title: `${SHARP_NAMES[root]} ${scale} scale`,
    goal: 'Play the scale up and back down, one note per beat.',
    intro: [`The notes are ${scaleSet.map((p) => noteName(p)).join(' · ')}. Start in Wait mode to find them, then Rhythm mode to play them evenly.`],
    bpm: 70, timeSig: [4, 4], hands: 'R', key, scale: scaleSet, pass: { minAccuracy: 0.9, minTiming: 0.7 },
    notes: scaleRun(root, scale).map((pitch, i) => ({ pitch, start: i, dur: 1, hand: 'R' })),
  })
  const practiceChord = () => onPractice({
    id: `explore-chord-${root}-${chordType}-${inv}`, stage: 4, kind: 'play', title: `${chordInfo?.name ?? 'Chord'} chord`,
    goal: 'Play the chord with all keys together, then break it up note by note.',
    intro: [`${chord.map((p) => noteName(p)).join(' – ')}${chordInfo ? ` (${chordInfo.quality}, ${chordInfo.inversion})` : ''}. In Wait mode the music waits until every key of the chord is down at once.`],
    bpm: 70, timeSig: [4, 4], hands: 'R', key, pass: { minAccuracy: 0.9, minTiming: 0.7 },
    notes: chordDrill(chord),
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
              <div className="row"><button className="btn small" onClick={() => void play(scaleRun(root, scale), true)}>▶ Hear it</button><button className="btn small primary" onClick={practiceScale}>Practice it</button></div>
            </div>
            <div className="card col" style={{ flex: 1, minWidth: 260 }}>
              <h3>Chord builder</h3>
              <div className="row">
                <select value={root} onChange={(e) => setRoot(+e.target.value)} aria-label="Chord root">{SHARP_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
                <select value={chordType} onChange={(e) => { setChordType(+e.target.value); setInv(0) }} aria-label="Chord type">{CHORD_TYPES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}</select>
              </div>
              <div className="seg">{CHORD_TYPES[chordType].iv.map((_, i) => <button key={i} className={inv === i ? 'active' : ''} onClick={() => setInv(i)}>{i === 0 ? 'Root' : `Inv ${i}`}</button>)}</div>
              <p><b>{chordInfo?.name ?? ''}</b> <span className="sub">{chord.map((p) => noteName(p)).join(' – ')}{chordInfo ? ` · ${chordInfo.inversion}` : ''}</span></p>
              <div className="row"><button className="btn small" onClick={() => void play(chord)}>▶ Play</button><button className="btn small" onClick={() => void play(chord, true)}>Arpeggio</button><button className="btn small primary" onClick={practiceChord}>Practice it</button></div>
              <span className="sub" style={{ fontSize: '0.8rem' }}>Notes fall onto the keys as they sound; yellow keys show where to put your fingers.</span>
            </div>
          </div>
        </div>
        <aside className="side"><TheoryPanel musicalKey={key} /><SoundPanel compact /></aside>
      </div>
    </div>
  )
}
