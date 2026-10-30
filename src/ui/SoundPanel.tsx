import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ARP_MAX_OCTAVES, ARP_MODES, ARP_RATES, transposeShape } from '../audio/arp'
import { audio, INSTRUMENTS, lightEngine, type InstrumentId } from '../audio/audioEngine'
import {
  allPresets, captureChord, ccFor, clearCC, currentParams, deleteUserPreset, getParam, learn, loadPreset, renameUserPreset,
  FADERS, moves, saveUserPreset, setCCMode, setParam, WIZARD, type CCMode,
} from '../audio/controls'
import { defaults, FILTER_TYPES, fromNorm, resolve, spec, toNorm, type Target } from '../audio/sound'
import { midi } from '../midi/midiInput'
import { RHYTHMS, SA_NAMES, type Drone, type Rhythm } from '../audio/kirtan'
import { identifyChord } from '../music/theory'
import { ccMap, settings, sound, userPresets, useStore, type SoundState } from '../store/store'
import { Knob } from './Knob'
import './SoundPanel.css'
import { PadSamples } from './PadSamples'

const useInst = () => useSyncExternalStore(settings.subscribe, () => settings.get().instrument)
const setSound = (patch: Partial<SoundState>) => sound.set(patch)
const BIPOLAR = new Set<Target>(['brightness', 'timbre', 'time', 'movement', 'eqLow', 'eqMid', 'eqHigh', 'width'])

// Double-click resets to the instrument's Init value (e.g. the piano's own release), not the generic one.
/** One parameter knob. It subscribes to its own value only, so a hardware knob re-renders just this knob. */
function ParamKnob({ id, big, learnMode }: { id: Target; big?: boolean; learnMode: boolean }) {
  const v = useSyncExternalStore(id === 'master' ? settings.subscribe : sound.subscribe, () => getParam(id))
  const s = spec(id)
  return (
    <Knob label={s.label} value={v} min={s.min} max={s.max} norm={toNorm(id, v)} text={s.fmt ? s.fmt(v) : String(v)} big={big}
      steps={s.curve === 'int' ? s.max - s.min : undefined} bipolar={BIPOLAR.has(id)}
      onNorm={(n) => setParam(id, fromNorm(id, n))} onReset={() => setParam(id, id === 'master' ? s.def : defaults(settings.get().instrument)[id])}>
      <LearnBadge id={id} learnMode={learnMode} />
    </Knob>
  )
}
const MODES: CCMode[] = ['auto', 'abs', 'rel']
function LearnBadge({ id, learnMode }: { id: Target; learnMode: boolean }) {
  const armed = useSyncExternalStore(learn.subscribe, () => learn.get().armed === id)
  const cc = useSyncExternalStore(ccMap.subscribe, () => ccFor(id))
  const mode = useSyncExternalStore(ccMap.subscribe, () => (cc === null ? 'auto' : ccMap.get().map[cc]?.mode ?? 'auto'))
  if (armed) return <button className="sp-learn sp-armed" onClick={() => learn.arm(null)} title="Cancel learn">Turn a knob…</button>
  if (!learnMode) return cc === null ? null : <span className="sp-cc" title={`Hardware CC ${cc}`}>CC{cc}</span>
  if (cc === null) return <button className="sp-learn" onClick={() => learn.arm(id)} title="Click, then turn a knob or fader on your keyboard">Learn</button>
  return (
    <span className="sp-ccrow">
      <button className="sp-cc" onClick={() => learn.arm(id)} title="Learn again">CC{cc}</button>
      <button className="sp-mode" onClick={() => setCCMode(id, MODES[(MODES.indexOf(mode) + 1) % 3])}
        title="Auto detects endless (relative) encoders; force Absolute or Relative if the knob jumps or moves the wrong way">{mode === 'auto' ? 'Auto' : mode === 'abs' ? 'Abs' : 'Rel'}</button>
      <button className="sp-x" onClick={() => clearCC(id)} aria-label={`Clear mapping for ${spec(id).label}`} title="Clear mapping">×</button>
    </span>
  )
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="sp-sec" open={open}>
      <summary>{title}</summary>
      <div className="sp-body">{children}</div>
    </details>
  )
}

function PresetBar({ inst }: { inst: InstrumentId }) {
  const name = useSyncExternalStore(sound.subscribe, () => sound.get().preset[inst] ?? 'Init')
  const users = useStore(userPresets).items
  const list = allPresets()
  const cur = list.find((p) => p.instrument === inst && p.name === name && p.user) ?? list.find((p) => p.instrument === inst && p.name === name)
  // "Edited" dot: the current sound no longer matches the loaded preset.
  const edited = useSyncExternalStore(sound.subscribe, () => !!cur && JSON.stringify(currentParams(inst)) !== JSON.stringify(resolve(inst, cur.params)))
  const [edit, setEdit] = useState<null | 'save' | 'rename'>(null)
  const [text, setText] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const key = (p: { instrument: string; name: string; user?: boolean }) => `${p.user ? 'u' : 'f'}|${p.instrument}|${p.name}`
  const idx = cur ? list.findIndex((p) => key(p) === key(cur)) : -1
  const step = (d: number) => loadPreset(list[(idx + d + list.length) % list.length])
  const taken = (n: string) => list.some((p) => p.instrument === inst && p.name === n && !p.user) // factory names stay unique
  const commit = () => {
    const n = text.trim()
    if (!n || taken(n)) return
    if (edit === 'save') saveUserPreset(n)
    else if (cur?.user) renameUserPreset(cur.name, n)
    setEdit(null)
  }
  if (edit) {
    return (
      <div className="sp-presets">
        <input type="text" autoFocus value={text} maxLength={40} aria-label="Preset name" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEdit(null) }} />
        <button className="btn small primary" onClick={commit} disabled={!text.trim() || taken(text.trim())}>{edit === 'save' ? 'Save' : 'Rename'}</button>
        <button className="btn small ghost" onClick={() => setEdit(null)}>Cancel</button>
      </div>
    )
  }
  return (
    <div className="sp-presets">
      <button className="btn small ghost sp-arrow" onClick={() => step(-1)} aria-label="Previous preset">‹</button>
      <select className="sp-select" aria-label="Preset" value={cur ? key(cur) : ''} onChange={(e) => { const p = list.find((x) => key(x) === e.target.value); if (p) loadPreset(p) }}>
        {!cur && <option value="">{name}</option>}
        {INSTRUMENTS.map((i) => (
          <optgroup key={i.id} label={i.label}>
            {list.filter((p) => p.instrument === i.id).map((p) => <option key={key(p)} value={key(p)}>{p.user ? `★ ${p.name}` : p.name}</option>)}
          </optgroup>
        ))}
      </select>
      <button className="btn small ghost sp-arrow" onClick={() => step(1)} aria-label="Next preset">›</button>
      {edited && <span className="sp-edited" title="Edited since the preset was loaded">●</span>}
      <span className="sp-grow" />
      <button className="btn small" onClick={() => { setText(cur?.user ? cur.name : `My ${INSTRUMENTS.find((i) => i.id === inst)?.label ?? 'sound'} ${users.filter((u) => u.instrument === inst).length + 1}`); setEdit('save') }}>Save</button>
      {cur?.user && <button className="btn small ghost" onClick={() => { setText(cur.name); setEdit('rename') }}>Rename</button>}
      {cur?.user && (confirmDel
        ? <button className="btn small danger" onClick={() => { deleteUserPreset(cur.name); setConfirmDel(false) }} onBlur={() => setConfirmDel(false)} autoFocus>Delete?</button>
        : <button className="btn small ghost" onClick={() => setConfirmDel(true)}>Delete</button>)}
    </div>
  )
}

function PerformSection() {
  const arp = useSyncExternalStore(sound.subscribe, () => sound.get().arp)
  const chord = useSyncExternalStore(sound.subscribe, () => sound.get().chord)
  const bpm = useSyncExternalStore(sound.subscribe, () => sound.get().bpm)
  const [msg, setMsg] = useState('')
  const setArp = (p: Partial<typeof arp>) => setSound({ arp: { ...arp, ...p } })
  const setBpm = (v: number) => setSound({ bpm: Math.round(Math.min(240, Math.max(40, v))) })
  // Tap tempo: the average gap of the last few taps; a pause over 2 s starts a new count.
  const taps = useRef<number[]>([])
  const tap = () => {
    const t = performance.now(), xs = (taps.current = [...taps.current.filter((x) => t - x < 2000), t].slice(-5))
    if (xs.length > 1) setBpm((60000 * (xs.length - 1)) / (t - xs[0]))
  }
  const swing = arp.swing ?? 0
  const info = identifyChord(transposeShape(chord.shape, 60))
  return (
    <Section title="Arpeggiator & chord memory">
      <p className="sp-hint">These change only what you hear in free play. Lessons always hear the keys you press.</p>
      <div className="sp-row">
        <button className={`btn small${arp.on ? ' on' : ''}`} aria-pressed={arp.on} onClick={() => setArp({ on: !arp.on })}>Arp</button>
        <button className={`btn small${arp.latch ? ' on' : ''}`} aria-pressed={arp.latch} onClick={() => setArp({ latch: !arp.latch })} title="Keep playing after you let go">Hold</button>
      </div>
      <div className="sp-row">
        <Knob label="Tempo" value={bpm} min={40} max={240} norm={(bpm - 40) / 200} text={`${bpm} BPM`} steps={200}
          onNorm={(n) => setBpm(40 + n * 200)} onReset={() => setBpm(100)} />
        <button className="btn small" onClick={tap} title="Tap a few times in time to set the tempo">Tap</button>
        <Knob label="Swing" value={swing} min={0} max={1} norm={swing} text={`${Math.round(swing * 100)}%`}
          onNorm={(n) => setArp({ swing: n })} onReset={() => setArp({ swing: 0 })} />
        <Knob label="Gate" value={arp.gate} min={0.05} max={1} norm={(arp.gate - 0.05) / 0.95} text={`${Math.round(arp.gate * 100)}%`}
          onNorm={(n) => setArp({ gate: 0.05 + n * 0.95 })} onReset={() => setArp({ gate: 0.6 })} />
      </div>
      <div className="seg sp-seg" aria-label="Arp mode">{ARP_MODES.map((m) => <button key={m.id} className={arp.mode === m.id ? 'active' : ''} onClick={() => setArp({ mode: m.id })}>{m.label}</button>)}</div>
      <div className="seg sp-seg" aria-label="Arp rate">{ARP_RATES.map((r, i) => <button key={r.label} className={arp.rate === i ? 'active' : ''} onClick={() => setArp({ rate: i })}>{r.label}</button>)}</div>
      <div className="sp-row">
        <div className="seg" aria-label="Octaves">{Array.from({ length: ARP_MAX_OCTAVES }, (_, i) => i + 1).map((o) => <button key={o} className={arp.octaves === o ? 'active' : ''} onClick={() => setArp({ octaves: o })}>{o} oct</button>)}</div>
      </div>
      <div className="sp-row">
        <button className={`btn small${chord.on ? ' on' : ''}`} aria-pressed={chord.on} onClick={() => setSound({ chord: { ...chord, on: !chord.on } })}>Chord memory</button>
        <button className="btn small" onClick={() => setMsg(captureChord([...midi.held.keys()]) ? '' : 'Hold 2 or more keys, then press Capture.')}>Capture held keys</button>
      </div>
      <p className="sp-hint">{msg || `One key plays: ${info ? `${info.name.replace(/^C/, '') || 'major'} chord` : 'chord'} (${chord.shape.join('·')} semitones)`}</p>
    </Section>
  )
}

function LearnSection({ learnMode, setLearnMode }: { learnMode: boolean; setLearnMode: (b: boolean) => void }) {
  const L = useSyncExternalStore(learn.subscribe, learn.get)
  const count = useSyncExternalStore(ccMap.subscribe, () => Object.keys(ccMap.get().map).length)
  const [last, setLast] = useState('')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => midi.onCC((e) => setLast(`CC ${e.cc} = ${e.raw} (ch ${e.channel})`)), [])
  const wizardStep = L.armed && (L.queue.length || L.used.length) ? WIZARD.length - L.queue.length : 0
  return (
    <Section title="Hardware knobs (MIDI learn)" open={learnMode || !!L.armed}>
      <div className="sp-row">
        <button className={`btn small${learnMode ? ' on' : ''}`} aria-pressed={learnMode} onClick={() => { setLearnMode(!learnMode); learn.arm(null) }}>MIDI learn</button>
        <button className="btn small primary" onClick={() => { setLearnMode(true); learn.wizard() }}>Map MiniLab knobs 1–8</button>
      </div>
      {wizardStep > 0 && (
        <div className="sp-wizard" role="status">
          <b>Turn knob {wizardStep} of {WIZARD.length}</b> → {spec(L.armed!).label}
          <button className="btn small ghost" onClick={() => learn.arm(null)}>Stop</button>
        </div>
      )}
      {!wizardStep && L.armed && <div className="sp-wizard" role="status">Turn a knob or fader for <b>{spec(L.armed).label}</b> <button className="btn small ghost" onClick={() => learn.arm(null)}>Cancel</button></div>}
      <p className="sp-hint">
        Click <b>Learn</b> under any control, then turn a knob or move a fader. Keys and pads are ignored.
        If a knob jumps or runs backwards, switch its mapping from Auto to Rel or Abs.
      </p>
      <div className="sp-row">
        <span className="sp-hint sp-mono">{last ? `Last: ${last}` : 'No knob messages yet'}</span>
        <span className="sp-grow" />
        {count > 0 && (confirm
          ? <button className="btn small danger" onClick={() => { ccMap.set({ map: {} }); setConfirm(false) }} onBlur={() => setConfirm(false)} autoFocus>Clear {count}?</button>
          : <button className="btn small ghost" onClick={() => setConfirm(true)}>Clear all</button>)}
      </div>
    </Section>
  )
}

/** A short "Reverb time 3.2 s" readout whenever a hardware knob or fader moves, wherever you are in the app. */
export function KnobReadout() {
  const m = useSyncExternalStore(moves.subscribe, moves.get)
  const value = useSyncExternalStore(sound.subscribe, () => (m ? getParam(m.target) : 0))
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!m) return
    setShown(true)
    const t = setTimeout(() => setShown(false), 1200)
    return () => clearTimeout(t)
  }, [m])
  if (!m) return null
  const s = spec(m.target)
  return (
    <div className={`sp-readout${shown ? ' show' : ''}`} role="status" aria-live="polite">
      <span>{s.label}</span><b>{s.fmt ? s.fmt(value) : value}</b>
      <i style={{ width: `${toNorm(m.target, value) * 100}%` }} />
    </div>
  )
}

/** Kirtan accompaniment under free play: drone on Sa, a dholak/kartal theka, and which kit the pads play. */
function KirtanSection() {
  const st = useStore(settings)
  const k = st.kirtan
  const set = (p: Partial<typeof k>) => settings.set({ kirtan: { ...k, ...p } })
  const bpm = useSyncExternalStore(sound.subscribe, () => sound.get().bpm)
  return (
    <Section title="Kirtan: drone, rhythm & pads" open={k.drone !== 'off' || k.rhythm !== 'off'}>
      <p className="sp-hint">Play along on harmonium or bansuri. Lessons bring their own rhythm, so the loop pauses there; the drone keeps going.</p>
      <div className="seg sp-seg" aria-label="Drone">
        {(['off', 'tanpura', 'shruti'] as Drone[]).map((d) => <button key={d} aria-pressed={k.drone === d} className={k.drone === d ? 'active' : ''} onClick={() => set({ drone: d })}>{d === 'off' ? 'No drone' : d === 'tanpura' ? 'Tanpura' : 'Shruti box'}</button>)}
      </div>
      <div className="sp-row">
        <label className="sp-bpm">Sa <select className="sp-select" value={k.sa} onChange={(e) => set({ sa: +e.target.value })}>{SA_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select></label>
        <label className="sp-bpm">BPM <input type="number" min={40} max={240} value={bpm} onChange={(e) => { const v = +e.target.value; if (v >= 40 && v <= 240) setSound({ bpm: v }) }} /></label>
      </div>
      <div className="seg sp-seg" aria-label="Rhythm">
        {(['off', 'kaharwa', 'dadra'] as Rhythm[]).map((r) => <button key={r} aria-pressed={k.rhythm === r} className={k.rhythm === r ? 'active' : ''} onClick={() => set({ rhythm: r })}>{r === 'off' ? 'No rhythm' : RHYTHMS[r].label}</button>)}
      </div>
      <div className="sp-row">
        <Knob label="Level" value={k.level} min={0} max={1} norm={k.level} text={`${Math.round(k.level * 100)}%`} onNorm={(n) => set({ level: n })} onReset={() => set({ level: 0.7 })} />
        <div className="seg" aria-label="Pads play">
          {(['standard', 'kirtan'] as const).map((id) => <button key={id} aria-pressed={st.padKit === id} className={st.padKit === id ? 'active' : ''} onClick={() => settings.set({ padKit: id })}>{id === 'standard' ? 'Pads: drum kit' : 'Pads: dholak & kartals'}</button>)}
        </div>
      </div>
    </Section>
  )
}

/** Analog Lab-style sound controls: presets, instrument, 4 macros, detailed sections, arp/chord, MIDI learn. */
export function SoundPanel({ compact }: { compact?: boolean }) {
  const inst = useInst()
  const [learnMode, setLearnMode] = useState(false)
  const filterType = useSyncExternalStore(sound.subscribe, () => getParam('filterType'))
  const k = (id: Target, big?: boolean) => <ParamKnob key={id} id={id} big={big} learnMode={learnMode} />
  const synth = inst !== 'piano'
  const light = audio.started ? audio.light : lightEngine()
  return (
    <section className={`sp${compact ? ' sp-compact' : ''}${learnMode ? ' sp-learning' : ''}`} aria-label="Sound">
      <PresetBar inst={inst} />
      <div className="seg sp-seg sp-inst" aria-label="Instrument">
        {INSTRUMENTS.map((i) => <button key={i.id} className={inst === i.id ? 'active' : ''} onClick={() => settings.set({ instrument: i.id })}>{i.label}</button>)}
      </div>
      {light && <p className="callout sub">Light engine (phones): only the filter, envelope and volume knobs change the sound. For reverb, delay, chorus and drive, pick Full under Settings → Sound engine.</p>}
      {/* Laid out like the MiniLab: knobs 1–4 (the macros), knobs 5–8, then the 4 faders. They work without MIDI learn. */}
      <div className="sp-hw-label">Knobs 1–4</div>
      <div className="sp-macros">{WIZARD.slice(0, 4).map((id) => k(id, true))}</div>
      <div className="sp-hw-label">Knobs 5–8</div>
      <div className="sp-macros sp-hw-row">{WIZARD.slice(4).map((id) => k(id))}</div>
      <div className="sp-hw-label">Faders</div>
      <div className="sp-macros sp-hw-row">{FADERS.map((id) => k(id))}</div>
      <Section title="Filter">
        <div className="seg sp-seg" aria-label="Filter type">
          {FILTER_TYPES.map((t, i) => <button key={t} className={filterType === i ? 'active' : ''} onClick={() => setParam('filterType', i)}>{['Low-pass', 'High-pass', 'Band-pass'][i]}</button>)}
        </div>
        <div className="sp-grid">{k('cutoff')}{k('resonance')}</div>
      </Section>
      <Section title="Envelope">
        <div className="sp-grid">{k('attack')}{synth && k('decay')}{synth && k('sustain')}{k('release')}</div>
      </Section>
      <Section title="Character">
        <div className="sp-grid">{k('drive')}{k('chorus')}{k('phaser')}{k('tremolo')}{k('lfoRate')}</div>
      </Section>
      <Section title="Delay"><div className="sp-grid">{k('delayDiv')}{k('delayFeedback')}{k('delayMix')}</div></Section>
      <Section title="Reverb"><div className="sp-grid">{k('reverbDecay')}{k('reverbPreDelay')}{k('reverbMix')}</div></Section>
      <Section title="EQ & width"><div className="sp-grid">{k('eqLow')}{k('eqMid')}{k('eqHigh')}{k('width')}</div></Section>
      {synth && <Section title="Synth"><div className="sp-grid">{inst === 'synth' && k('glide')}{k('vibratoRate')}</div></Section>}
      <Section title="Mix" open={!compact}><div className="sp-grid">{k('master')}{k('keysVol')}{k('drumsVol')}</div></Section>
      <KirtanSection />
      <Section title="Pad sounds: record your own"><PadSamples /></Section>
      <PerformSection />
      <LearnSection learnMode={learnMode} setLearnMode={setLearnMode} />
      {!audio.started && <p className="sp-hint">Sound starts with your first key or click; your settings are applied then.</p>}
    </section>
  )
}
