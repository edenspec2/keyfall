# Tasks

## Team and ownership

| Role | Owns | Contract |
|---|---|---|
| Planner / architect | `docs/ARCHITECTURE.md`, `PRODUCT_SPEC.md`, `ROADMAP.md`, this file | `src/music/types.ts` |
| Music expert | `src/lessons/curriculum.ts`, `docs/CURRICULUM.md` | lessons must type-check against `Lesson` and stay in 48–72 |
| Engineer | `src/**` except lesson data, `tests/`, `e2e/` | keeps `npm test` and `npm run test:e2e` green |
| Reviewer | review reports, never edits code | findings must name file:line, scenario and required fix |

## Automated checks (all passing)

`npm test` – 109 unit tests: MIDI parsing (Note On vel 0, CC64, channels), port choice (MiniLab main port vs MIDIIN2/MCU,
pads on ch 10), simultaneous notes, unplug/replug, octave-shifted pitches; Transport pause/tempo; scoring windows, chords,
repeated notes, octave errors, Wait-mode chord rule; Session Wait/Rhythm/Loop (20 loop passes without drift), pause sync;
feedback text and stars; recorder onsets/durations/sustain; quantize; MIDI export round-trip; harmony suggestions;
chord voicings and every lesson inside 48–72; reviewer regressions (150 ms output latency, early loop downbeats,
mid-piece loop count-in, resume rewind, sample-accurate jam loops, slowest-tempo rule, loop/one-hand star caps).

`npm run test:e2e` – 4 browser tests in Edge: first-run → first lesson completed in Wait mode → progress kept after
reload; frame timing during playback (p95 < 40 ms); record → save → reload → export `.mid`; a take in progress
survives leaving the Create page.

## Manual checklist (needs the MiniLab 3, speakers and ears – NOT yet done)

- [ ] Chrome/Edge asks for MIDI permission; after "Allow" the sidebar shows **Minilab3 MIDI** with a green dot.
- [ ] Settings log: one Note On per key press, Note Off on release; pads (ch 10) do not sound when "Ignore drum pads" is on.
- [ ] DAW-mode buttons do not produce notes (Automatic port).
- [ ] Lowest key at default octave detected as **C3** in setup; after Oct+ it shows C4 and lessons say "press Oct −".
- [ ] Velocity: soft vs hard presses are clearly quieter/louder.
- [ ] Sustain pedal (if connected) holds notes; release stops them; nothing sticks.
- [ ] Unplug the MiniLab mid-lesson: held notes stop, status turns yellow; plug back in: notes work without reload.
- [ ] Open MIDI Control Center first: app shows the "another program is using it" message; close it → Rescan → works.
- [ ] Key → sound delay feels immediate with wired headphones (target < 20 ms extra over the OS).
- [ ] Rhythm mode: playing honestly on the beat gives mostly "perfect/good"; if not, run the tap test and re-check.
- [ ] Watch mode: falling notes hit the line exactly when the sound starts (no visible lead/lag).
- [ ] Piano sample quality and release tails sound natural; alternative instruments work.
- [ ] Pads: pad 1 plays the kick, pad 2 the snare … (if not, Settings → Detect pad 1); pads never sound as piano notes.
- [ ] Bank B pads play the same 8 drums; pad velocity changes the loudness.
- [ ] Pitch strip bends the Synth lead up/down and springs back; mod strip adds vibrato; nothing bends on the grand piano.
- [ ] Stage 7: "Meet the pads" is scorable in Rhythm mode with real pads; "Beat in one hand" is playable with keys + pads.
- [ ] Recording in Create keeps the feel when replayed; exported `.mid` opens in a DAW with right tempo and notes.

## Open items

- [ ] Knobs and faders (MIDI learn for filter, reverb, track volume); pads as chord buttons; Arp/Chord-mode lessons.
- [ ] Record pitch-bend and vibrato in Create takes.

- [ ] Hardware checklist above.
- [ ] Per-track instruments in Create (tracks have an `instrument` field; playback uses the global instrument).
- [ ] Sheet-music view.
- [ ] `swing`, `pickup`, `sections` fields in the lesson contract (requested by the music expert).
- [ ] Two lessons a musician should double-check: Greensleeves (F vs F♯), Minuet in G (bars 7 and 15, simplified LH).
