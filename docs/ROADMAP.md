# Roadmap

Status as of 2026-10-26. "Done" means its automated checks pass; hardware items are listed in `TASKS.md` → manual checklist.

| Milestone | Scope | Acceptance criteria | Status |
|---|---|---|---|
| 1 Playable foundation | MIDI input, keys shown, piano audio, falling notes, one full lesson, Wait mode, pitch feedback | MIDI parse/filter/reconnect tests; Wait-mode session test; e2e: first lesson completed in Wait mode | **Done** (automated); needs MiniLab check |
| 2 Learning experience | Onboarding, 30 lessons, tempo, Rhythm & Loop modes, scoring, stars, saved progress, feedback text | Scorer, feedback, loop-drift and pause-sync tests; e2e: progress survives reload | **Done** |
| 3 Music understanding | Scales, chords, theory panel, ear training, patterns, first improvisation | Chord/interval/roman tests; voicings fit 48–72; echo + improvise lessons playable | **Done** (ear training = echo lessons) |
| 4 Creation studio | Record, piano roll edit, quantize, replay, save/load, MIDI export/import, chord suggestions | Recorder, quantize, SMF round-trip, harmony tests; e2e: record → save → reload → export | **Done** |
| 4b Beyond the keys | Pads as a drum kit (lessons, Create drum track, GM export/import), pitch bend and vibrato on the touch strips, Stage 7 lessons | Pad routing, pad scoring, drum auto-play, take routing, drum MIDI round-trip, bend/vibrato counting tests | **Done** (automated); needs MiniLab check |
| 5 Refinement | Latency tuning on real hardware, accessibility pass, sheet-music view, per-track instruments, swing, pickup bars | Manual checklist all green on the MiniLab | Next |

## Next priorities

1. Run the manual hardware checklist with the MiniLab 3; adjust calibration defaults from real numbers.
2. Lesson polish from a musician playing through all 30 lessons (fingerings, Greensleeves/Minuet versions).
3. Curriculum contract additions the music expert asked for: `swing`, `pickup`, sections for feedback, per-chord target tones.
4. Notation view (VexFlow) as a second renderer over the same `NoteEvent[]`.
5. Optional AI tutor that reads `Summary` + attempt history and writes the feedback paragraph.
