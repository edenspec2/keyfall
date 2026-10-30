import { useState, useSyncExternalStore } from 'react'
import { audio } from '../audio/audioEngine'
import { clearPad, loadPadFile, padSampler, pressSample, sampleKey, teachSampleKey } from '../audio/padSamples'
import { bindingName } from '../midi/binding'
import { currentDrums } from '../music/drums'
import { useStore } from '../store/store'

const STATUS = {
  listening: '🎙 Listening… make your sound (or hit a pad to give it back its drum)',
  recording: '🔴 Recording… it stops when you go quiet',
  pick: '🥁 Hit a pad to put your sound on it',
}

/** On every page: what the sampler is doing, since the flow runs from the keyboard while you look away. */
export function PadSampleStatus() {
  const s = useSyncExternalStore(padSampler.subscribe, padSampler.get)
  return s.phase === 'idle' ? null : <div className="sample-status" role="status">{STATUS[s.phase]}</div>
}

/** Sound panel: record or load a sound onto a pad, teach the keyboard's Sample button, play or clear each pad. */
export function PadSamples() {
  const s = useSyncExternalStore(padSampler.subscribe, padSampler.get)
  const { key } = useStore(sampleKey)
  const [fileError, setFileError] = useState('')
  const drums = currentDrums()
  return (
    <>
      <p className="sp-hint">Press <b>Sample</b>, make a sound (a clap, your voice, a cup), then hit a pad: it plays your sound from then on.
        Sample, then a pad without making a sound, gives that pad its drum back. Teach a spare key or pad to do it all from the keyboard.</p>
      <div className="sp-row">
        <button className={`btn small${s.phase !== 'idle' ? ' on' : ''}`} aria-pressed={s.phase !== 'idle'} onClick={() => void pressSample()}>
          {s.phase === 'idle' ? '🎙 Sample' : s.phase === 'pick' ? 'Drop it' : 'Stop'}
        </button>
        <button className={`btn small${s.teaching ? ' on' : ''}`} onClick={() => teachSampleKey(!s.teaching)}>
          {s.teaching ? 'Press a key, pad or button…' : key ? `Sample button: ${bindingName(key)}` : 'Teach a keyboard button'}
        </button>
        {key && <button className="btn small ghost" aria-label="Forget the Sample button" onClick={() => sampleKey.set({ key: null })}>✕</button>}
      </div>
      {s.phase !== 'idle' && <p className="sp-hint" role="status">{STATUS[s.phase]}</p>}
      {(s.error || fileError) && <p className="sp-hint" style={{ color: 'var(--bad)' }}>{s.error || fileError}</p>}
      <div className="col" style={{ gap: 4 }}>
        {drums.map((d, k) => (
          <div key={k} className="sp-row" style={{ gap: 6 }}>
            <span className="sub" style={{ width: 16 }}>{k + 1}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.names[k] ? `🎙 ${s.names[k]}` : d.name}</span>
            <button className="btn small ghost" aria-label={`Play pad ${k + 1}`} onClick={() => void audio.start().then(() => audio.drum(k))}>▶</button>
            <label className="btn small ghost" title="Load an audio file onto this pad">File
              <input type="file" accept="audio/*" hidden onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (f) loadPadFile(k, f).then(() => setFileError(''), (err) => setFileError(`Could not load ${f.name}: ${err.message ?? err}`))
              }} />
            </label>
            {s.names[k] && <button className="btn small ghost" aria-label={`Give pad ${k + 1} its drum back`} onClick={() => clearPad(k)}>✕</button>}
          </div>
        ))}
      </div>
    </>
  )
}
