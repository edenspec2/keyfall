# Curriculum: teacher's notes

Data: `src/lessons/curriculum.ts` (30 lessons, 6 stages). Learner: adult beginner, ex-flute player (reads melody, knows
rhythm, thinks in one line), loves piano music, wants the *why* and wants to compose. Keyboard: 25 keys, C3–C5
(MIDI 48–72). Every lesson fits that range, so no lesson needs the octave buttons.

## Progression

| Stage | Lessons | Why here |
|---|---|---|
| 1 Discover the keyboard | Hot Cross Buns (3 notes) · Mary, C position · left hand hello · same tunes on black keys | A real tune in the first two minutes. Finger numbers and the C position before anything else. The left hand alone before hands together. Black keys show that a melody is a *pattern* (transposition), which matters later for theory. |
| 2 Rhythm & coordination | Au clair (long notes) · Mary with LH on beat 1 · black-key jam · Jingle Bells (dotted) · mirror/parallel | Rhythm is not new to a flutist; the piano's *decay* is, so long notes must be counted. Two hands start with one left-hand note per bar. Improvising comes early (pentatonic, no wrong notes) so creativity is part of the habit, not a reward at the end. |
| 3 Scales, intervals, patterns | C scale RH · C scale LH · intervals by ear · sequences · A minor (natural → harmonic) | Thumb-under is the first real piano technique. Intervals get song anchors. Sequences show how composers stretch one idea. A minor = same keys, new home; the G♯ introduces the leading tone. |
| 4 Chords & harmony | Triads C F G · inversions · I–V–vi–IV · arpeggios · broken-chord accompaniment · I–vi–ii–V7–I | What a single-line player could never do. Order: build (thirds) → move efficiently (inversions) → a loop everyone knows → spread it (arpeggios) → use it under a melody → explain the pull home (B→C, F→E). |
| 5 Playing real music | Ode to Joy · Twinkle (ABA) · Frère Jacques over a drone · Greensleeves · Minuet in G (in C) | Public-domain pieces, each with one new musical skill: balance (melody over a quieter LH), form and contrast, repeats with intent, 3/4 + legato in minor, a 16-bar dance with a walking bass. Dynamics live in `vel`. |
| 6 Improvisation & composition | Pentatonic over four chords · question and answer · minor mood · 12-bar blues · compose 8 bars | Each improvisation adds one constraint that makes the result sound composed: chord tones on beat 1, open vs closed endings, a minor home, the blues form, and finally motif → repeat → vary → cadence, recorded in Create. |

Two transpositions to fit 25 keys, both said in the lesson intro: Greensleeves sits low (E3–F4, right hand only, no
room for a bass below it); the Minuet is played in C (B3–C5) instead of G.

## Mastery rules

* One star = `pass.minAccuracy` reached (pitch) and, in Rhythm/Loop mode, `pass.minTiming`. Thresholds rise with
  the stage: 0.8 → 0.85/0.7 → 0.85/0.75 → 0.88/0.75 → 0.9/0.8. Ear training 0.75. Improvising 0.8–0.85 (= fraction of
  notes inside `scale`).
* Suggested ladder per piece: Wait mode (pitch only) → Rhythm at 70 % tempo → Rhythm at 100 %. Unlock the next lesson
  after one star in Wait mode; count the lesson "mastered" only at full tempo in Rhythm mode.
* Never block a stage on an improvise or echo lesson; they are playgrounds.
* If timing < 0.6 three times in a row, suggest 70 % tempo or Loop on the weakest bars, not "try again".

## How the app should talk

* **Lead with what went right**, then one thing to fix. Never more than one correction at a time.
  "Bars 1–4 were clean. Bar 6: the dotted note came early; hold it a little longer."
* **Name the musical thing, not the error count.** "You rushed the half notes" beats "7 timing errors". Use the bar
  number and the note name ("the E in bar 3"), since the learner reads melody.
* **Octave slips** (±12): "Right note, wrong octave: press Oct–", never "wrong note".
* **Released early**: on piano, connect to the flute: "Hold the key the whole length, even while the sound fades,
  like holding a long note to the end of the breath."
* **Hands together falling apart**: recommend hands separately, then Wait mode. It's normal; say so.
* **Wrong notes in improvising do not exist**; outside-scale notes are "spicy notes". Praise rests and repetition
  ("nice: you repeated your idea"), since those make improvisation sound like music.
* **Explain the why in one sentence, at the right moment** (after the piece, not during): "That G7 felt like it needed
  to resolve because B wants to rise to C."
* Tone: friendly, adult, short. No exclamation-mark spam, no "Great job!!" for a 40 % run. Honest, specific, warm.

## Stage 7 – Pads, bends & grooves (side track)

Opens after "Counting long notes" (the first rhythm lesson), so drumming starts early instead of after the whole course.
Meet the pads (kick 1 & 3, snare 2 & 4, then eighth-note hi-hat) → Beat in one hand, chords in the other (left-hand
pads under the C–Am–F–G loop, common-tone voice leading) → Groove on the offbeat (kick on the "and" of 2, open hat
lift) → Make it sing (A minor pentatonic synth jam; feedback rewards bends and vibrato, linked to flute vibrato).
Drum grooves are written with `groove()` in `curriculum.ts`: one character per eighth note.

