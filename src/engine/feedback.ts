import type { Lesson, PracticeMode } from '../music/types'
import { PAD_PITCH } from '../music/drums'
import { noteNameOct } from '../music/theory'
import type { Summary } from './scorer'

export interface Attempt { date: number; mode: PracticeMode; bpm: number; accuracy: number; timing: number | null; stars: number }

export interface Feedback {
  headline: string
  stars: number // 0..3
  good: string[]
  improve: string[]
  next: string
}

/**
 * Stars: 1 = notes learned (Wait mode accuracy ≥ pass), 2 = played in time (Rhythm ≥ pass at ≥ 75 % tempo),
 * 3 = played in time at full tempo with ≥ 90 % timing. Mastery is measured, never time-based.
 * Loop mode practises a passage, so it never awards stars; one hand of a two-hand piece earns at most 1.
 */
export function starsFor(lesson: Lesson, mode: PracticeMode, s: Summary, bpm: number, oneHandOnly = false): number {
  const p = lesson.pass
  if (mode === 'loop' || s.accuracy < p.minAccuracy) return 0
  if (mode === 'wait' || oneHandOnly) return 1
  const timingOk = (s.timing ?? 0) >= (p.minTiming ?? 0.7)
  if (!timingOk || bpm < lesson.bpm * 0.75) return 1
  return bpm >= lesson.bpm && (s.timing ?? 0) >= 0.9 ? 3 : 2
}

const bar = (beat: number, beatsPerBar: number) => Math.floor(beat / beatsPerBar) + 1
const pct = (x: number) => `${Math.round(x * 100)}%`

/** Bars with the most problems, as "bar 3" / "bars 5–6". */
function worstBars(beats: number[], beatsPerBar: number): string | null {
  if (!beats.length) return null
  const counts = new Map<number, number>()
  for (const b of beats) counts.set(bar(b, beatsPerBar), (counts.get(bar(b, beatsPerBar)) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map((e) => e[0]).sort((a, b) => a - b)
  if (top.length === 2 && top[1] === top[0] + 1) return `bars ${top[0]}–${top[1]}`
  return top.length === 1 ? `bar ${top[0]}` : `bars ${top[0]} and ${top[1]}`
}

export function makeFeedback(lesson: Lesson, mode: PracticeMode, s: Summary, bpm: number, history: Attempt[], oneHandOnly = false): Feedback {
  const bpb = lesson.timeSig[0]
  const stars = starsFor(lesson, mode, s, bpm, oneHandOnly)
  const good: string[] = []
  const improve: string[] = []
  const slower = Math.max(40, Math.round((bpm * 0.8) / 5) * 5)

  if (s.accuracy === 1) good.push(`Every note was correct (${s.expected}/${s.expected}).`)
  else if (s.accuracy >= 0.8) good.push(`${s.hits} of ${s.expected} notes were correct (${pct(s.accuracy)}).`)

  if (s.timing !== null && s.hits) {
    if (s.timing >= 0.9) good.push(`Your rhythm was steady: ${pct(s.timing)} of notes landed on the beat.`)
    const lateOnes = s.notes.filter((n) => n.grade === 'late'), earlyOnes = s.notes.filter((n) => n.grade === 'early')
    const offs = [...lateOnes, ...earlyOnes]
    if (offs.length >= 2) {
      const dir = lateOnes.length > earlyOnes.length * 1.5 ? 'after' : earlyOnes.length > lateOnes.length * 1.5 ? 'before' : null
      const where = worstBars(offs.map((n) => n.start), bpb)
      const avg = Math.round(offs.reduce((t, n) => t + Math.abs(n.offsetMs ?? 0), 0) / offs.length)
      improve.push(dir
        ? `${s.accuracy >= 0.9 ? 'Your notes were correct, but ' : ''}${offs.length} notes came slightly ${dir} the beat (about ${avg} ms), mostly in ${where}. ${dir === 'after' ? 'Look ahead to the next note while the current one sounds.' : 'Let the falling note touch the line before you press – count out loud.'} Try it again at ${slower} BPM.`
        : `${offs.length} notes were off the beat in both directions, mostly in ${where}. Turn on the metronome and count "1 and 2 and" out loud at ${slower} BPM.`)
    }
  }

  const missed = s.notes.filter((n) => n.grade === 'missed' || !n.grade)
  if (missed.length) {
    const where = worstBars(missed.map((n) => n.start), bpb)
    const loopTip = mode === 'wait' ? '' : missed.length >= 3 ? ` Practise ${where} in Wait mode until the notes feel familiar, then Loop ${where} in time.` : ''
    improve.push(`${missed.length} note${missed.length > 1 ? 's were' : ' was'} missed, mostly in ${where}.${loopTip}`)
  }

  // Most common wrong-note confusion: "you played F where F♯ was written".
  const pairs = new Map<string, { played: number; expected: number; beats: number[] }>()
  for (const w of s.wrong) if (w.expected !== null && Math.abs(w.played - w.expected) !== 12) {
    const k = `${w.played}>${w.expected}`
    const e = pairs.get(k) ?? { played: w.played, expected: w.expected, beats: [] }
    e.beats.push(w.beat); pairs.set(k, e)
  }
  const top = [...pairs.values()].sort((a, b) => b.beats.length - a.beats.length)[0]
  if (top) {
    const dist = top.played - top.expected
    const keys = top.played < PAD_PITCH && top.expected < PAD_PITCH
    const hint = !keys ? (top.played >= PAD_PITCH && top.expected >= PAD_PITCH ? ' – check which pad is which on screen' : '') : Math.abs(dist) === 1 ? (dist > 0 ? ' – one key too high' : ' – one key too low') : ''
    improve.push(`You played ${noteNameOct(top.played)} where ${noteNameOct(top.expected)} was written${hint} (${top.beats.length}×, ${worstBars(top.beats, bpb)}).`)
  }
  if (s.octaveErrors >= 2) improve.push(`Right notes, wrong octave (${s.octaveErrors}×). Press Oct + or Oct − on your MiniLab until middle C (C4) is near the middle of the keyboard.`)
  if (s.extras >= Math.max(3, s.expected * 0.2) && !top) improve.push(`You pressed ${s.extras} extra keys. Rest your fingers on their starting keys (see the finger numbers) so they don't wander.`)
  if (s.releasedEarly >= 2) improve.push(`${s.releasedEarly} long notes were released too early. Keep the key down and count the full length – unlike a flute, the piano keeps sounding only while you hold the key.`)

  // Progress against earlier attempts in the same mode.
  const prev = history.filter((a) => a.mode === mode)
  const last = prev[prev.length - 1]
  if (last) {
    const d = s.accuracy - last.accuracy
    if (d >= 0.05) good.push(`Accuracy went up from ${pct(last.accuracy)} to ${pct(s.accuracy)} since last time.`)
    else if (s.timing !== null && last.timing !== null && s.timing - last.timing >= 0.05) good.push(`Timing improved from ${pct(last.timing)} to ${pct(s.timing)}.`)
  }

  let next: string
  // Three weak-timing runs in a row: change the practice, don't just repeat it.
  const lastTwo = prev.slice(-2)
  const stuck = s.timing !== null && s.timing < 0.6 && lastTwo.length === 2 && lastTwo.every((a) => a.timing !== null && a.timing < 0.6)
  if (mode === 'loop') next = s.accuracy >= lesson.pass.minAccuracy && (s.timing ?? 0) >= (lesson.pass.minTiming ?? 0.7)
    ? 'That passage is solid. Now play the whole piece in Rhythm mode to earn the stars.'
    : `Keep looping this passage${bpm > lesson.bpm * 0.6 ? ` – drop to ${slower} BPM if it keeps slipping` : ''}.`
  else if (oneHandOnly && stars >= 1) next = 'One hand done. Now try it with both hands – Wait mode first.'
  else if (stuck) next = `Timing has been hard three times in a row – that's normal. Drop to ${Math.round(lesson.bpm * 0.7)} BPM, or use Loop mode on ${worstBars(s.notes.filter((n) => n.grade !== 'perfect' && n.grade !== 'good').map((n) => n.start), bpb) ?? 'the hardest bars'} only.`
  else if (stars === 0) next = mode === 'wait'
    ? 'Play it once more in Wait mode – take your time to find each key.'
    : `Switch to Wait mode to learn the notes without time pressure, then come back to Rhythm mode at ${slower} BPM.`
  else if (stars === 1 && mode === 'wait') next = `Notes learned! Now try Rhythm mode at ${Math.round(lesson.bpm * 0.8)} BPM to play it in time.`
  else if (stars === 1) next = bpm < lesson.bpm * 0.75 ? `Good. Raise the tempo to ${Math.round(lesson.bpm * 0.8)} BPM for the next attempt.` : `Play it again at ${slower} BPM and focus on landing each note with the line.`
  else if (stars === 2) next = bpm < lesson.bpm ? `Lesson passed. For 3 stars, try ${lesson.bpm} BPM – or move on to the next lesson.` : 'Lesson passed! Move on to the next lesson, or aim for 3 stars with steadier timing.'
  else next = 'Mastered. On to the next lesson!'

  const headline = mode === 'loop' ? (s.accuracy >= lesson.pass.minAccuracy ? 'Clean pass!' : 'Keep looping') : stars === 3 ? 'Beautiful – mastered!' : stars === 2 ? 'Lesson passed!' : stars === 1 ? (mode === 'wait' ? 'Notes learned!' : 'Getting there!') : s.accuracy >= 0.6 ? 'Good start – a few more tries' : 'Let\'s slow it down'
  if (!good.length) good.push(s.hits ? `You found ${s.hits} of the ${s.expected} notes.` : 'You played through the whole piece.')
  return { headline, stars, good, improve, next }
}

/** Improvisation is judged on musical choices, not right/wrong notes. */
export function improvFeedback(s: { notes: number; inScale: number; distinct: number; span: number; bends?: number; vibrato?: number }, scaleName: string, minInScale = 0.8, expressive = false): Feedback {
  const good: string[] = [], improve: string[] = []
  if (expressive) {
    if ((s.bends ?? 0) >= 2) good.push(`You bent the pitch ${s.bends} times – that's what makes a synth lead sing.`)
    else improve.push('Use the pitch strip: start a note, then slide your finger up the strip and back so the note bends like a voice.')
    if ((s.vibrato ?? 0) >= 1) good.push('You added vibrato with the mod strip – just like the vibrato on a long flute note.')
    else improve.push('On a long note, push the mod strip up a little for vibrato, then bring it back down.')
  }
  let stars = 0
  if (s.notes >= 12 && s.inScale >= minInScale) stars = 1
  if (stars && s.distinct >= 5 && s.span >= 7) stars = 2
  if (stars === 2 && s.notes >= 32 && s.inScale >= 0.9) stars = 3
  if (s.notes) good.push(`You played ${s.notes} notes, ${pct(s.inScale)} of them from the ${scaleName}.`)
  if (s.distinct >= 5) good.push(`You used ${s.distinct} different notes across ${s.span} half steps – a real melodic range.`)
  if (s.notes < 12) improve.push('Play a little more: aim for at least 3–4 short phrases. Leave gaps between them, like breathing on the flute.')
  else if (s.inScale < minInScale) improve.push(`Many notes fell outside the ${scaleName}. Watch the purple dots on the keys – every one of them sounds good over this backing.`)
  if (s.notes >= 12 && s.distinct < 5) improve.push('You stayed on a few notes. Try climbing up the scale step by step, then jumping back down.')
  if (s.notes >= 12 && s.span < 7) improve.push('Your melody stayed in a narrow range. Try one phrase high and an answer low.')
  return {
    headline: stars ? 'That sounded like music!' : 'Nice start – keep jamming',
    stars, good: good.length ? good : ['You started improvising – that is the hardest step.'], improve,
    next: stars >= 2 ? 'Record an idea you liked in Create, or move on.' : 'Jam once more: play short phrases and end each one on the first note of the scale.',
  }
}
