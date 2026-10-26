# Architecture

Browser app: React 19 + TypeScript + Vite, Tone.js for audio, Web MIDI for input, Canvas 2D for the falling notes.
Runs in Chrome or Edge on Windows (both ship Web MIDI). Fully offline once installed; piano samples live in `public/samples`.

## Modules (`src/`)

| Folder | Owns | Talks to |
|---|---|---|
| `music/` | `types.ts` (the data contract), `theory.ts` (note names, intervals, chords, scales), `midiFile.ts` (SMF export) | everything; no dependencies itself |
| `midi/` | `MidiInput`: device list, port selection, Note On/Off/CC64 parsing, hot-plug, a 200-message log for the diagnostic screen | emits `InputEvent`s to subscribers |
| `audio/` | `AudioEngine`: Tone context, sampled piano (Salamander) with synth fallback, alt instruments, velocity, sustain, metronome click, master volume | transport (for scheduling) |
| `engine/` | `Transport` (the one clock), `Scorer` (matching and grading), `Session` (ties a lesson + mode + transport + scorer + audio together), `Recorder` | midi, audio, music |
| `lessons/` | curriculum data (`curriculum.ts`) authored against `music/types.ts` | engine, UI |
| `render/` | `FallingNotes` canvas renderer: reads transport time and input state each frame | engine (read-only) |
| `store/` | localStorage persistence: settings, progress, attempts, compositions | UI |
| `ui/` | React screens: Learn, Practice, Explore, Create, Progress, Settings, Onboarding, MIDI diagnostics | everything above |

React never re-renders per animation frame. The renderer and the session run in a `requestAnimationFrame` loop
against plain mutable objects; React only shows coarse state (mode, paused, score at the end).

## One clock

`Transport` holds the musical position in **beats**. It is anchored to the Web Audio clock:

```
beat(now) = anchorBeat + (audioCtx.currentTime - anchorAudio) * bpm / 60     (while playing)
beat(now) = anchorBeat                                                        (while paused)
```

Play, pause, seek and tempo change all re-anchor (`anchorBeat = beat(now)`, `anchorAudio = currentTime`), so pausing and
tempo changes never drift. The renderer, the audio scheduler and the scorer all read this one function.

Converting a beat to audio time (for scheduling): `audioTime = anchorAudio + (beat - anchorBeat) * 60 / bpm`.

### MIDI timestamps → audio time → beats

Web MIDI stamps each message with `event.timeStamp` in the `performance.now()` domain (ms). We convert with a pair of
clock readings taken together:

```
audioTime = audioCtx.currentTime + (event.timeStamp - performance.now()) / 1000
beat      = transport.beatAt(audioTime)
```

`audioCtx.currentTime` advances in render-quantum steps (~3 ms), well under the ±80 ms "perfect" window, so this is
accurate enough for scoring. A user-set **input latency offset** (Settings → calibration, default 0 ms) is subtracted
for systems where the user hears audio late (Bluetooth headphones, large buffers).

Live notes from the keyboard are played with `Tone.immediate()` (no lookahead), so the key→sound path is as short as the
browser allows. Auto-played notes (Watch mode, the other hand, backing tracks) are scheduled 100 ms ahead on the audio
clock by a lookahead scheduler, so they are sample-accurate and both paths use the same instrument.

## Practice modes share one engine

`Session` = lesson notes + `Transport` + `Scorer` + scheduler. Modes only change three switches:

| Mode | User plays | Transport | Timing scored |
|---|---|---|---|
| Watch | nothing | runs | no |
| Wait | chosen hand(s) | stops at each expected chord until all its pitches are pressed | no (pitch only) |
| Rhythm | chosen hand(s) | runs | yes |
| Loop | chosen hand(s) | runs between loop markers, repeats; each pass scored | yes |
| Free | anything | stopped; keyboard + theory panel only | no |

Notes are grouped into **chords** = notes of the user's hand(s) with the same onset (±1/32 beat).

### Scoring (`engine/scorer.ts`)

* Window per note: |Δ| ≤ 80 ms → perfect, ≤ 160 ms → good, ≤ 300 ms → early/late, otherwise not a match.
  Windows are in milliseconds (converted with current bpm), so slow tempos are not harsher.
* A press is matched to the nearest unmatched expected note of the same pitch in the window; otherwise it is an
  **extra** note. Expected notes whose window passes are **missed**.
* Duration: on release, held < 50 % of the written length → "released early" (reported, not penalised in the score).
* Octave mistakes (pitch ± 12 of an expected pitch) are counted separately so feedback can say "press Oct-".
* Wait mode: a chord is satisfied when every pitch in it has been pressed since the chord became current
  (keys may be pressed one by one). Wrong notes are counted but nothing is timed.
* Scoring, finishing and drawing all use the *heard* beat (`Session.heardBeat`); only scheduling uses the raw clock.
* Loop mode: near the loop end, a press that fits the next pass's downbeat is scored there; the previous pass stays
  open for late presses until its window closes. The next pass's backing notes and clicks are scheduled before the wrap.
  Loop runs never award stars (they practise a passage, not the piece).
* Summary: accuracy = hits / expected, timing = (perfect + good) / hits, plus per-note offsets for feedback text.

## Pads and touch strips

* MiniLab pads send notes on channel 10. `routePads` turns them into `pad` events (drum 0–7 = Kick, Snare, Closed hat,
  Open hat, Clap, Low tom, High tom, Crash), counted from the note of pad 1 (`padBase`, default 36, "Detect pad 1" in
  Settings); bank B maps onto the same 8 drums. Settings can also ignore pads or treat them as piano notes.
* Drum hits are ordinary `NoteEvent`s with `drum` set and `pitch = 200 + drum` (`music/drums.ts`), so the scorer, Wait
  mode, loops, the recorder and the piano roll handle them without special cases. They are never in `midi.held`.
* Sound: a synthesized kit (Tone Membrane/Noise/Metal synths, no samples). Pitch bend (±2 semitones) and mod-strip
  vibrato act on the synth sounds; the sampled piano does not bend. Lessons can pick a sound (`instrument`); their
  backing then plays on the electric piano so it doesn't bend along.
* MIDI export puts drum tracks on channel 10 with General MIDI notes; import maps channel 10 back to the kit.
* *shortcut:* bends and vibrato are not recorded in Create; add automation lanes if takes need them.

## Persistence

`localStorage` keys, versioned with `v1`: `settings`, `progress` (per lesson: best accuracy/timing, stars, attempt
history), `compositions`. All reads are wrapped in try/catch and fall back to defaults.
*shortcut: localStorage caps at ~5 MB; move compositions to IndexedDB if they ever exceed ~1 MB.*

## Keyboard range

Default lesson range is C3–C5 (MIDI 48–72), which is what a MiniLab 3 sends at its default octave. Onboarding asks
the user to press the lowest key, so the app knows the device's current range. If a lesson goes outside it, the
practice screen says which octave button to press. The keyboard drawn on screen is the union of the lesson's range and
the device range, so larger keyboards work without changes.

## Decisions

* **Plain CSS with variables instead of Tailwind** – one stylesheet, no build plugin, enough for a single-theme app.
* **Canvas 2D instead of WebGL** – a 25–49-key view with a few hundred notes draws in well under 2 ms per frame.
* **No sheet music in v1** – the spec puts falling notes first; notation is a later milestone.
* **Listen to all MIDI inputs by default** – the MiniLab 3 exposes several ports (`Minilab3 MIDI`, `MIDIIN2 (Minilab3 MIDI)`, …);
  the user can pin one port and one channel in Settings. Pads (channel 10 by default) can be ignored with one toggle.

## Sound engine

`audio/` is split so everything except the Tone graph is plain, testable TypeScript:

| File | Role |
|---|---|
| `sound.ts` | parameter specs (range, curve, format), per-instrument Init, `effective()` = detailed params bent by the 4 macros, factory presets |
| `controls.ts` | store glue: `getParam/setParam`, presets (load/save/rename/delete), chord capture, MIDI learn and CC decoding |
| `arp.ts` | arpeggiator note order (`arpPattern`) and chord-memory shapes (pure) |
| `perform.ts` | free-play arp + chord memory; arp notes go through the lookahead scheduler (100 ms ahead, 25 ms wake-ups) on the audio clock |
| `audioEngine.ts` | the Tone graph |

Signal path: voices → (vibrato for synths) → `input` → drive → filter → EQ3 → chorus → phaser → tremolo → keys vol → delay → reverb
→ stereo width → compressor → limiter → out. Drums → drums vol → delay (no filter or modulation). Stages at zero are taken out of the path
(after their ramp to 0), so idle effects cost nothing. Values change with 40 ms ramps; reverb time and pre-delay re-render the impulse,
so they are debounced (250 ms), and the old impulse keeps playing until the new one is ready.

Macros: 0.5 leaves the sound as designed. **Brightness** → cutoff ±4 octaves, high shelf ±6 dB. **Timbre** → piano: drive and mid tilt;
e-piano: FM index (and drive); strings: AM harmonicity 1–4; synth: detune of the 3 stacked saws. **Time** → attack, release and reverb
time ×¼…×4. **Movement** → chorus, tremolo (keys) or phaser (strings/synth) depth, and the LFO rate.

The sound per instrument, user presets, the arp/chord settings, the tempo (`sound.bpm`) and CC mappings are persisted (`sound`, `presets`,
`ccmap`). `live.ts` pushes the store into the engine; the engine keeps the values until `start()` and applies them then.

Arp and chord memory only change what sounds: `live.ts` calls `perform.noteOn` *after* `midi.emit`, so the scorer and recorder still get the
raw keys. Lessons set `audio.performFx = false`; then live notes go straight to `audio.noteOn`.

MIDI learn: Control Changes other than 1 and 64 become `CCEvent`s on `midi.onCC`, not `InputEvent`s, so they never reach the scorer or
the screens. A mapping is `cc → target` with mode auto / absolute / relative. Auto treats a CC as relative once it repeats a value inside
57–71 (binary offset) or 1–7 / 121–127 (two's complement), because absolute knobs only send on change; until it can tell (fewer than
4 values, all in a relative band) it ignores the message instead of jumping.
*shortcut: mappings ignore the MIDI channel; key them by channel too if a second controller sends the same CC numbers.*
