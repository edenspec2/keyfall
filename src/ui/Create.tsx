import { useEffect, useMemo, useRef, useState } from 'react'
import { audio } from '../audio/audioEngine'
import { quantize, Recorder } from '../engine/recorder'
import { Session, type SessionState } from '../engine/session'
import { midi } from '../midi/midiInput'
import { accompaniment, detectKey, suggestChords } from '../music/harmony'
import { parseMidiFile, toMidiFile } from '../music/midiFile'
import { DRUMS, PAD_PITCH } from '../music/drums'
import { isBlack, noteNameOct, pc, scalePcs } from '../music/theory'
import type { Lesson, NoteEvent } from '../music/types'
import { draft, library, settings, sound, useStore, type Composition, type Track } from '../store/store'

const uid = () => Math.random().toString(36).slice(2, 10)
const TRACK_COLORS = ['#0ea5e9', '#f97316', '#8b5cf6', '#10b981', '#f43f5e'] // saturated enough for both themes
const GRIDS = [{ v: 1, l: '1/4' }, { v: 0.5, l: '1/8' }, { v: 0.25, l: '1/16' }, { v: 1 / 3, l: '1/8 triplet' }]
const ROW = 14, KEYW = 52

export const newComposition = (): Composition => ({
  id: uid(), name: 'Untitled idea', bpm: 90, timeSig: [4, 4], updated: Date.now(),
  tracks: [{ id: uid(), name: 'Piano', instrument: 'piano', notes: [] }],
})

/**
 * Put a recorded take into the composition: pad hits go to the drum track (created if needed),
 * key notes to the selected track, or the first melodic track if the drum track is selected.
 */
export function mergeTake(c: Composition, active: number, take: NoteEvent[]): Composition {
  const hits = take.filter((n) => n.drum !== undefined), keys = take.filter((n) => n.drum === undefined)
  let tracks = [...c.tracks]
  const add = (i: number, notes: NoteEvent[]) => { tracks[i] = { ...tracks[i], notes: [...tracks[i].notes, ...notes].sort((a, b) => a.start - b.start) } }
  if (keys.length) {
    let i = tracks[active] && !tracks[active].drums ? active : tracks.findIndex((t) => !t.drums)
    if (i < 0) { tracks = [...tracks, { id: uid(), name: 'Piano', instrument: 'piano', notes: [] }]; i = tracks.length - 1 }
    add(i, keys)
  }
  if (hits.length) {
    let i = tracks.findIndex((t) => t.drums)
    if (i < 0) { tracks = [...tracks, { id: uid(), name: 'Drums', instrument: 'piano', notes: [], drums: true }]; i = tracks.length - 1 }
    add(i, hits)
  }
  return { ...c, tracks }
}

/** A composition is played by the same engine as lessons: it becomes a Watch-mode "lesson". */
function asLesson(c: Composition, notes: NoteEvent[], countIn: number): Lesson {
  return { id: 'composition', stage: 6, kind: 'play', title: c.name, goal: '', intro: [], bpm: c.bpm, timeSig: c.timeSig, notes, hands: 'R', pass: { minAccuracy: 0 }, countIn }
}

export function Create() {
  const st = useStore(settings)
  const lib = useStore(library)
  const [comp, setCompRaw] = useState<Composition>(() => draft.get().comp ?? (lib.items[0] ? structuredClone(lib.items[0]) : newComposition()))
  const [active, setActive] = useState(0)
  const [sel, setSel] = useState<number | null>(null)
  const [grid, setGrid] = useState(0.5)
  const [zoom, setZoom] = useState(1)
  const [state, setState] = useState<SessionState | 'recording'>('ready')
  const [dirty, setDirty] = useState(() => draft.get().dirty)
  const [showLib, setShowLib] = useState(false)
  const history = useRef<Composition[]>([])
  const sess = useRef<Session | null>(null)
  const rec = useRef<Recorder | null>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const rollRef = useRef<HTMLDivElement>(null)

  const setComp = (c: Composition, undoable = true) => {
    if (undoable) history.current = [...history.current.slice(-50), comp]
    setCompRaw(c); setDirty(true)
  }
  const updateTrack = (i: number, f: (t: Track) => Track, undoable = true) =>
    setComp({ ...comp, tracks: comp.tracks.map((t, k) => (k === i ? f(t) : t)) }, undoable)
  const track = comp.tracks[Math.min(active, comp.tracks.length - 1)]

  // ---- transport ----
  const stop = () => {
    const s = sess.current
    if (!s) return
    if (rec.current) {
      const take = rec.current.stop(performance.now())
      rec.current = null
      if (take.length) setComp(mergeTake(comp, active, take))
    }
    s.onState = undefined
    s.pause(); audio.panic()
    sess.current = null
    setState('ready')
  }
  const play = async (record: boolean) => {
    stop()
    await audio.start(); audio.setVolume(st.volume)
    const notes = comp.tracks.filter((t) => !t.muted).flatMap((t) => t.notes)
    const s = new Session(asLesson(comp, notes, record ? comp.timeSig[0] : 0), {
      mode: 'watch', hands: 'R', bpm: comp.bpm, metronome: st.metronome || record, loop: null, calibration: st.calibrationMs / 1000, endless: record,
    }, audio)
    s.onState = (x) => { setState(record && x === 'playing' ? 'recording' : x); if (x === 'done') sess.current = null }
    sess.current = s
    if (record) rec.current = new Recorder((perf) => s.transport.beatAt(audio.heard(perf) - s.opts.calibration))
    s.start()
    if (record) setState('recording')
  }
  useEffect(() => midi.on((e) => { if (rec.current && sess.current?.state === 'playing') rec.current.input(e) }), [])

  // Keep the open composition as a draft; on leaving the page, finish a running take into it.
  const live = useRef({ comp, active })
  live.current = { comp, active }
  useEffect(() => { draft.set({ comp, dirty }) }, [comp, dirty])
  useEffect(() => { sound.set({ bpm: comp.bpm }) }, [comp.bpm])
  useEffect(() => () => {
    sess.current?.pause(); audio.panic()
    if (!rec.current) return
    const take = rec.current.stop(performance.now())
    const { comp: c, active: a } = live.current
    if (take.length) draft.set({ dirty: true, comp: mergeTake(c, a, take) })
  }, [])

  // Playhead + session clock, outside React.
  const pxBeat = 48 * zoom
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const s = sess.current
      s?.tick()
      if (playhead.current) {
        const b = s ? Math.max(0, s.visualBeat()) : 0
        playhead.current.style.transform = `translateX(${KEYW + b * pxBeat}px)`
        playhead.current.style.opacity = s ? '1' : '0'
        // Follow the playhead while playing.
        const r = rollRef.current
        if (s && r && KEYW + b * pxBeat > r.scrollLeft + r.clientWidth - 80) r.scrollLeft = KEYW + b * pxBeat - 120
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [pxBeat])

  // ---- piano roll geometry ----
  // The roll shows either the melodic tracks (pitch rows) or the drum track (one row per drum), never both.
  const drumView = !!track.drums
  const inView = (t: Track) => !!t.drums === drumView
  const everything = comp.tracks.flatMap((t) => t.notes)
  const all = comp.tracks.filter((t) => !t.drums).flatMap((t) => t.notes)
  const lo = drumView ? PAD_PITCH : Math.min(48, ...all.map((n) => n.pitch - 2))
  const hi = drumView ? PAD_PITCH + DRUMS.length - 1 : Math.max(72, ...all.map((n) => n.pitch + 2))
  const bpb = comp.timeSig[0]
  const beats = Math.max(8 * bpb, Math.ceil((Math.max(0, ...everything.map((n) => n.start + n.dur)) + 2 * bpb) / bpb) * bpb)
  const preview = (p: number, dur: number, vel = 80) => void audio.start().then(() => (p >= PAD_PITCH ? audio.drum(p - PAD_PITCH, audio.now(), vel) : audio.schedule(p, audio.now(), dur, vel)))
  const rows = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)
  const snap = (b: number) => Math.round(b / grid) * grid

  const key = useMemo(() => detectKey(all), [comp]) // eslint-disable-line react-hooks/exhaustive-deps
  const keyPcs = key ? scalePcs(key.root, 'major') : []
  const chords = useMemo(() => (key && !drumView && track.notes.length >= 3 ? suggestChords(track.notes, key.root, bpb) : []), [key, track, bpb])

  const drag = useRef<{ mode: 'move' | 'resize'; i: number; x: number; y: number; orig: NoteEvent } | null>(null)
  const onNoteDown = (e: React.PointerEvent, i: number, mode: 'move' | 'resize') => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setSel(i)
    history.current = [...history.current.slice(-50), comp]
    drag.current = { mode, i, x: e.clientX, y: e.clientY, orig: track.notes[i] }
    if (mode === 'move') preview(track.notes[i].pitch, 0.25, 70)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const db = (e.clientX - d.x) / pxBeat, dp = -Math.round((e.clientY - d.y) / ROW)
    const o = d.orig
    const n: NoteEvent = d.mode === 'move'
      ? { ...o, start: Math.max(0, e.altKey ? o.start + db : snap(o.start + db)), pitch: Math.max(drumView ? lo : 21, Math.min(drumView ? hi : 108, o.pitch + dp)) }
      : { ...o, dur: Math.max(grid / 2, e.altKey ? o.dur + db : snap(o.start + o.dur + db) - o.start) }
    if (drumView) n.drum = n.pitch - PAD_PITCH
    if (n.pitch !== track.notes[d.i].pitch && audio.started) preview(n.pitch, 0.2, 60)
    updateTrack(active, (t) => ({ ...t, notes: t.notes.map((x, k) => (k === d.i ? n : x)) }), false)
  }
  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const b = Math.max(0, Math.floor((e.clientX - r.left - KEYW) / pxBeat / grid) * grid)
    const p = hi - Math.floor((e.clientY - r.top) / ROW)
    if (p < lo || p > hi) return
    if (e.clientX - r.left < KEYW) { preview(p, 0.5); return }
    const note: NoteEvent = drumView
      ? { pitch: p, drum: p - PAD_PITCH, start: b, dur: Math.min(grid, 0.25), vel: 100, hand: 'L' }
      : { pitch: p, start: b, dur: Math.max(grid, 0.5), vel: 80, hand: p < 60 ? 'L' : 'R' }
    updateTrack(active, (t) => ({ ...t, notes: [...t.notes, note] }))
    setSel(track.notes.length)
    preview(p, 0.3)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) {
        updateTrack(active, (t) => ({ ...t, notes: t.notes.filter((_, k) => k !== sel) })); setSel(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && history.current.length) { setCompRaw(history.current.pop()!); setSel(null) }
      if (e.code === 'Space') { e.preventDefault(); if (sess.current) stop(); else void play(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- library / files ----
  const save = () => {
    const c = { ...comp, updated: Date.now() }
    library.set((l) => ({ items: [c, ...l.items.filter((x) => x.id !== c.id)] }))
    setCompRaw(c); setDirty(false)
  }
  const exportMidi = () => {
    const bytes = toMidiFile(comp.tracks.map((t) => ({ name: t.name, notes: t.notes, drums: t.drums })), comp.bpm, comp.timeSig)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'audio/midi' }))
    a.download = `${comp.name.replace(/[^\w\- ]+/g, '').trim() || 'composition'}.mid`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importMidi = async (f: File) => {
    try {
      const m = parseMidiFile(new Uint8Array(await f.arrayBuffer()))
      const tracks = m.tracks.filter((t) => t.length).map((notes, i): Track => {
        const drums = notes.every((n) => n.drum !== undefined)
        return { id: uid(), name: drums ? 'Drums' : `Track ${i + 1}`, instrument: 'piano', notes, drums }
      })
      if (!tracks.length) throw new Error('no notes')
      stop(); setComp({ ...newComposition(), name: f.name.replace(/\.midi?$/i, ''), bpm: m.bpm, tracks }); setActive(0)
    } catch (err) { alert(`Could not read that MIDI file (${err instanceof Error ? err.message : err}).`) }
  }

  const busy = state === 'playing' || state === 'recording'
  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-head">
        <div className="row">
          <input type="text" value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value }, false)} aria-label="Composition name" style={{ fontSize: '1.3rem', fontWeight: 650, width: 280 }} />
          {dirty && <span className="sub">unsaved</span>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowLib(!showLib)}>📂 My songs ({lib.items.length})</button>
          <button className="btn" onClick={() => { stop(); setComp(newComposition()); setActive(0) }}>New</button>
          <button className="btn primary" onClick={save}>Save</button>
          <button className="btn" onClick={exportMidi} disabled={!everything.length}>Export .mid</button>
          <label className="btn">Import .mid<input type="file" accept=".mid,.midi,audio/midi" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importMidi(f); e.target.value = '' }} /></label>
        </div>
      </div>

      {showLib && (
        <div className="card col">
          <h3>My songs</h3>
          {!lib.items.length && <p className="sub">Nothing saved yet.</p>}
          {lib.items.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{c.name} <span className="sub">· {c.tracks.reduce((a, t) => a + t.notes.length, 0)} notes · {c.bpm} BPM · {new Date(c.updated).toLocaleString()}</span></span>
              <span className="row">
                <button className="btn small" onClick={() => { stop(); setCompRaw(structuredClone(c)); setActive(0); setDirty(false); setShowLib(false); history.current = [] }}>Open</button>
                <button className="btn small danger" onClick={() => { if (confirm(`Delete "${c.name}"?`)) library.set((l) => ({ items: l.items.filter((x) => x.id !== c.id) })) }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card row" style={{ gap: 14 }}>
        <button className={`btn ${state === 'recording' ? 'on' : ''}`} style={{ color: 'var(--bad)' }} onClick={() => (state === 'recording' ? stop() : void play(true))} title="Record onto the selected track (other tracks play along)">● {state === 'recording' ? 'Stop recording' : 'Record'}</button>
        <button className="btn primary" onClick={() => (busy ? stop() : void play(false))}>{busy ? '■ Stop' : '▶ Play'}</button>
        <label className="row" style={{ gap: 6 }}>Tempo <input type="number" min={30} max={240} value={comp.bpm} onChange={(e) => setComp({ ...comp, bpm: Math.max(30, Math.min(240, +e.target.value || 90)) }, false)} style={{ width: 70 }} disabled={busy} /> BPM</label>
        <select value={comp.timeSig[0]} onChange={(e) => setComp({ ...comp, timeSig: [+e.target.value, 4] })} aria-label="Time signature" disabled={busy}>
          {[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}/4</option>)}
        </select>
        <button className={`btn small ${st.metronome ? 'on' : ''}`} onClick={() => settings.set({ metronome: !st.metronome })}>Metronome</button>
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }}>Grid
          <select value={grid} onChange={(e) => setGrid(+e.target.value)}>{GRIDS.map((g) => <option key={g.l} value={g.v}>{g.l}</option>)}</select>
        </label>
        <button className="btn small" onClick={() => updateTrack(active, (t) => ({ ...t, notes: quantize(t.notes, grid) }))} disabled={!track.notes.length} title="Snap the selected track to the grid">Quantize</button>
        <button className="btn small" onClick={() => updateTrack(active, (t) => ({ ...t, notes: quantize(t.notes, grid, 0.5) }))} disabled={!track.notes.length} title="Move notes half-way to the grid – tighter but still human">Quantize 50%</button>
        <label className="row" style={{ gap: 6 }}>Zoom <input type="range" min={0.5} max={2.5} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14 }}>
        <div className="col">
          {comp.tracks.map((t, i) => (
            <div key={t.id} className="card col" style={{ padding: 12, gap: 6, borderColor: i === active ? TRACK_COLORS[i % 5] : undefined, cursor: 'pointer' }} onClick={() => { setActive(i); setSel(null) }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <input type="text" value={t.name} onChange={(e) => updateTrack(i, (x) => ({ ...x, name: e.target.value }), false)} style={{ width: 110, padding: '2px 6px' }} aria-label="Track name" />
                <span className="row" style={{ gap: 4 }}>{t.drums && <span className="sub" title="Drum track: record with the pads">Drums</span>}<span className="dot" style={{ background: TRACK_COLORS[i % 5] }} /></span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className={`btn small ${t.muted ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); updateTrack(i, (x) => ({ ...x, muted: !x.muted })) }}>{t.muted ? 'Muted' : 'Mute'}</button>
                {comp.tracks.length > 1 && <button className="btn small danger" onClick={(e) => { e.stopPropagation(); if (!t.notes.length || confirm(`Delete track "${t.name}"?`)) { setComp({ ...comp, tracks: comp.tracks.filter((_, k) => k !== i) }); setActive(0) } }}>✕</button>}
                <span className="sub" style={{ fontSize: '0.8rem' }}>{t.notes.length} notes</span>
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" onClick={() => { setComp({ ...comp, tracks: [...comp.tracks, { id: uid(), name: `Track ${comp.tracks.length + 1}`, instrument: 'piano', notes: [] }] }); setActive(comp.tracks.length) }}>+ Add track</button>
            {!comp.tracks.some((t) => t.drums) && <button className="btn small" onClick={() => { setComp({ ...comp, tracks: [...comp.tracks, { id: uid(), name: 'Drums', instrument: 'piano', notes: [], drums: true }] }); setActive(comp.tracks.length) }}>+ Drums</button>}
          </div>
          <p className="sub" style={{ fontSize: '0.8rem' }}>While recording, the pads (or keys <span className="kbd">1</span> to <span className="kbd">8</span>) always go to the drum track and the keys to the selected piano track. Play a beat and a melody in one take, or layer them.</p>

          <div className="card col" style={{ padding: 12, gap: 8 }}>
            <h3>Suggestions</h3>
            {!key ? <p className="sub">Record or draw a few notes and I'll suggest a key and chords.</p> : <>
              <p>Key: <b>{key.name}</b> <span className="sub">({Math.round(key.fit * 100)}% of notes fit)</span></p>
              <p className="sub" style={{ fontSize: '0.85rem' }}>Shaded rows are notes of {key.name} – safe choices for new notes.</p>
              {chords.length > 0 && <>
                <p className="sub" style={{ fontSize: '0.85rem' }}>Chords that fit "{track.name}", bar by bar:</p>
                <div className="row" style={{ gap: 4 }}>{chords.map((c) => <span key={c.bar} className="pill" title={`Bar ${c.bar + 1}: ${c.roman}`}>{c.name}</span>)}</div>
                <button className="btn small" onClick={() => { setComp({ ...comp, tracks: [...comp.tracks, { id: uid(), name: 'Chords', instrument: 'piano', notes: accompaniment(chords, bpb) }] }) }}>+ Add left-hand chords</button>
              </>}
            </>}
          </div>
          <p className="sub" style={{ fontSize: '0.8rem' }}>Click the grid to add a note · drag to move · drag the right edge to resize · <span className="kbd">Del</span> removes · <span className="kbd">Ctrl Z</span> undo · <span className="kbd">Alt</span> = no snap · <span className="kbd">Space</span> play/stop</p>
        </div>

        <div className="roll" ref={rollRef} onPointerMove={onMove} onPointerUp={() => { drag.current = null }}>
          <div style={{ position: 'relative', width: KEYW + beats * pxBeat, height: rows.length * ROW + 18 }} onPointerDown={onGridDown}>
            {/* bar numbers + chord suggestions */}
            {Array.from({ length: beats / bpb }, (_, b) => (
              <div key={b} className="sub" style={{ position: 'absolute', left: KEYW + b * bpb * pxBeat + 4, top: 0, fontSize: 11, pointerEvents: 'none' }}>{b + 1}{chords[b] ? ` · ${chords[b].name}` : ''}</div>
            ))}
            <div style={{ position: 'absolute', top: 18, left: 0, right: 0 }}>
              {rows.map((p, i) => drumView ? (
                <div key={p} style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW, background: i % 2 ? 'var(--roll-row)' : 'var(--roll-row-alt)', borderBottom: '1px solid var(--roll-sep)' }}>
                  <div style={{ width: KEYW, height: ROW, background: 'var(--panel-2)', color: DRUMS[p - PAD_PITCH].color, fontWeight: 650, fontSize: 9, lineHeight: `${ROW}px`, paddingLeft: 4, position: 'sticky', left: 0, zIndex: 1, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden' }}>{DRUMS[p - PAD_PITCH].name}</div>
                </div>
              ) : (
                <div key={p} style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW, background: isBlack(p) ? 'var(--roll-black-row)' : keyPcs.includes(pc(p)) ? 'var(--roll-key-row)' : 'var(--roll-row)', borderBottom: pc(p) === 0 ? '1px solid var(--roll-c)' : '1px solid var(--roll-sep)' }}>
                  <div style={{ width: KEYW, height: ROW, background: isBlack(p) ? 'var(--roll-key-black)' : 'var(--roll-key-white)', color: isBlack(p) ? 'var(--roll-key-text-black)' : 'var(--roll-key-text)', borderRight: '1px solid var(--roll-sep)', fontSize: 9, lineHeight: `${ROW}px`, paddingLeft: 4, position: 'sticky', left: 0, zIndex: 1, cursor: 'pointer' }}>{pc(p) === 0 || !isBlack(p) ? noteNameOct(p) : ''}</div>
                </div>
              ))}
              {/* One element draws every grid, beat and bar line as layered repeating gradients. */}
              <div className="roll-grid" style={{ left: KEYW, width: beats * pxBeat, height: rows.length * ROW, '--bar': `${bpb * pxBeat}px`, '--beat': `${pxBeat}px`, '--step': `${grid * pxBeat}px` } as React.CSSProperties} />
              {comp.tracks.map((t, ti) => !inView(t) ? null : t.notes.map((n, i) => {
                const mine = ti === active
                return (
                  <div key={`${t.id}-${i}`} className={`roll-note ${mine && sel === i ? 'sel' : ''}`}
                    style={{ left: KEYW + n.start * pxBeat, top: (hi - n.pitch) * ROW + 1, width: Math.max(4, n.dur * pxBeat - 1), height: ROW - 2, background: TRACK_COLORS[ti % 5], opacity: t.muted ? 0.15 : mine ? 0.45 + 0.55 * ((n.vel ?? 80) / 127) : 0.25, pointerEvents: mine ? 'auto' : 'none' }}
                    onPointerDown={(e) => onNoteDown(e, i, 'move')}
                    onDoubleClick={(e) => { e.stopPropagation(); updateTrack(active, (x) => ({ ...x, notes: x.notes.filter((_, k) => k !== i) })); setSel(null) }}
                    title={`${noteNameOct(n.pitch)} · beat ${+(n.start + 1).toFixed(2)} · ${+n.dur.toFixed(2)} beats · vel ${n.vel ?? 80}`}>
                    {mine && <div className="grip" onPointerDown={(e) => onNoteDown(e, i, 'resize')} />}
                  </div>
                )
              }))}
            </div>
            <div className="playhead" ref={playhead} style={{ left: 0, opacity: 0 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
