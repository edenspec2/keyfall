# Keyfall – product spec

**For:** an adult beginner with an Arturia MiniLab 3 (25 keys) on a Windows PC, who played flute, knows some theory,
loves piano music and wants to understand and compose, not just press keys.

**Promise:** plug in the MiniLab, play a real tune within two minutes, and keep coming back because each session teaches
one musical idea and ends with specific, honest feedback.

## Core loop

1. **Learn** – pick the next lesson (unlocked by mastery, not time).
2. **Practice** – falling notes onto a drawn keyboard. Wait → Rhythm → Loop until it is clean.
3. **Feedback** – what went well, the one or two things to fix (with bar numbers and note names), the next step.
4. **Create** – from Stage 2 on, jam and record your own ideas; edit them in a piano roll, save, export MIDI.

## Screens

| Screen | Purpose | Must have |
|---|---|---|
| First-run setup | Connect → choose input → test keys (+ detect lowest key) → sound → timing → first lesson | Works without a keyboard (computer keys); explains MIDI permission and busy ports |
| Learn | 6 stages, 30 lessons, stars, locks, "Continue" | Locks follow stars; "unlock all" in Settings |
| Practice | Falling notes, modes, tempo, zoom, labels, metronome, loop bars, theory side panel, results | Wait / Rhythm / Watch / Loop share one engine; Space = play/pause |
| Explore | Free play with rising notes, scale and chord explorers, live theory panel | Every chord the player holds is named and explained |
| Create | Record (with count-in, other tracks playing), piano roll, quantize, tracks, key & chord suggestions, save/load, MIDI import/export | Play → Record → Edit → Replay → Save → Export |
| Progress | Streak, minutes, stars per stage, recent attempts | All numbers come from measured play |
| Settings | MIDI device/channel/pads + live message log, keyboard range, sound, calibration tap test, learning options | Troubleshooting text for the MiniLab 3 |

## Feedback rules (deterministic)

* Scoring windows ±80 ms perfect, ±160 ms good, ±300 ms early/late (×1.25 in stages 1–2), in milliseconds so slow tempos
  are not harsher.
* Wait mode never judges time or note length.
* Stars: ★ notes learned (Wait accuracy ≥ lesson threshold) · ★★ in time at ≥ 75 % tempo · ★★★ full tempo, ≥ 90 % timing.
* Messages name the musical problem, the bar and a concrete action ("…came slightly after the beat in bars 5–6. Try it at
  65 BPM."). An LLM tutor can later consume the same `Summary` object.

## Out of scope for v1 (by decision)

Sheet-music view, per-track instruments in Create, drum patterns, MIDI-file import as a *lesson*, cloud sync, accounts.
