import { PAD_PITCH } from '../music/drums'
import type { Hand, Lesson, NoteEvent } from '../music/types'

// ---------------------------------------------------------------------------
// Tiny notation helpers so the melodies read like sheet music and can be
// checked note by note.  Token = pitch[+pitch]:dur[:finger[+finger]][:vel]
//   'E4:1:3'            E4, one beat, finger 3
//   'C4+E4+G4:4:1+3+5'  chord, whole note, fingers per note
//   'r:1'               rest of one beat
//   '|'                 bar line: asserts we are exactly on a bar boundary
// ---------------------------------------------------------------------------

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function midi(name: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name)
  if (!m) throw new Error(`curriculum: bad note name "${name}"`)
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

function line(hand: Hand, src: string, opt: { start?: number; bar?: number; vel?: number } = {}): NoteEvent[] {
  const { start = 0, bar = 4, vel } = opt
  const out: NoteEvent[] = []
  let t = start
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '|') {
      if (t % bar !== 0) throw new Error(`curriculum: bar line at beat ${t} in "${src.slice(0, 40)}…"`)
      continue
    }
    const [p, d, f, v] = tok.split(':')
    const dur = Number(d)
    if (p !== 'r') {
      const fingers = f ? f.split('+') : []
      p.split('+').forEach((name, i) => {
        const ev: NoteEvent = { pitch: midi(name), start: t, dur, hand }
        if (fingers[i]) ev.finger = Number(fingers[i])
        const vv = v ? Number(v) : vel
        if (vv) ev.vel = vv
        out.push(ev)
      })
    }
    t += dur
  }
  return out
}

/** 'C:4 Am:4 F:2 G:2' → chord symbols at their beats. */
function prog(src: string, start = 0): { beat: number; name: string }[] {
  let t = start
  return src.trim().split(/\s+/).filter((x) => x !== '|').map((tok) => {
    const [name, d] = tok.split(':')
    const c = { beat: t, name }
    t += Number(d)
    return c
  })
}

// Close voicings for auto-played backing chords, all inside the left-hand zone (48–59).
const V: Record<string, string> = {
  C: 'C3+E3+G3',
  Am: 'C3+E3+A3',
  F: 'C3+F3+A3',
  G: 'D3+G3+B3',
  'F#': 'F#3+A#3',
  'D#m': 'D#3+A#3',
  'C#': 'C#3+G#3',
}

/** Soft block chords on beats 1 and 3 of every bar (4/4), one chord name per bar. */
const pad = (bars: string[]) => line('L', bars.map((c) => `${V[c]}:2 ${V[c]}:2 |`).join(' '), { vel: 58 })
const barProg = (bars: string[]) => prog(bars.map((c) => `${c}:4`).join(' '))

// Drum grooves for the pads, written like a step sequencer: one character per eighth note,
// 'x' = hit, 'X' = accented hit, '.' = rest; spaces and '|' are only for reading.
const DRUM_ROW: Record<string, number> = { K: 0, S: 1, H: 2, O: 3, C: 4, T: 5, t: 6, X: 7 }
function groove(rows: Record<string, string>, hands: Record<string, Hand> = {}): NoteEvent[] {
  const out: NoteEvent[] = []
  for (const [name, pattern] of Object.entries(rows)) {
    const drum = DRUM_ROW[name]
    if (drum === undefined) throw new Error(`curriculum: unknown drum "${name}"`)
    const steps = pattern.replace(/[\s|]/g, '')
    if (steps.length % 8) throw new Error(`curriculum: groove row ${name} is not whole bars`)
    ;[...steps].forEach((c, i) => {
      if (c === '.') return
      out.push({ pitch: PAD_PITCH + drum, drum, start: i / 2, dur: 0.25, vel: c === 'X' ? 115 : 90, hand: hands[name] ?? (drum === 2 || drum === 3 ? 'R' : 'L') })
    })
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

// Boogie-woogie left hand (5–6–♭7–6 against the root), kept at or below B♭3.
const BOOGIE: Record<string, string> = {
  C: 'C3+G3:1 C3+A3:1 C3+Bb3:1 C3+A3:1 |',
  F: 'C3+F3:1 D3+F3:1 Eb3+F3:1 D3+F3:1 |',
  G: 'D3+G3:1 E3+G3:1 F3+G3:1 E3+G3:1 |',
}

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11]
const A_MINOR = [9, 11, 0, 2, 4, 5, 7]
const C_PENTA = [0, 2, 4, 7, 9]
const BLACK_PENTA = [1, 3, 6, 8, 10]
const C_BLUES = [0, 3, 5, 6, 7, 10]

// Melodies reused by several lessons.
const MARY = `E4:1:3 D4:1:2 C4:1:1 D4:1:2 | E4:1:3 E4:1:3 E4:2:3 | D4:1:2 D4:1:2 D4:2:2 | E4:1:3 G4:1:5 G4:2:5 |
  E4:1:3 D4:1:2 C4:1:1 D4:1:2 | E4:1:3 E4:1:3 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 E4:1:3 D4:1:2 | C4:4:1 |`
const MARY_CHORDS = 'C:4 C:4 G:4 C:4 C:4 C:4 G:4 C:4'

/** One bar of a 4-note broken-chord ostinato in eighths (low–mid–top–mid, twice), fingers 1–f–5–f. */
const ostinato = (lo: string, mid: string, top: string, f: number) => `${lo}:.5:1 ${mid}:.5:${f} ${top}:.5:5 ${mid}:.5:${f} `.repeat(2) + '|'

const MINUET_A =`G4:1:5 C4:.5:1 D4:.5:2 E4:.5:3 F4:.5:4 | G4:1:5 C4:1:1 C4:1:1 | A4:1:5 F4:.5:1 G4:.5:2 A4:.5:3 B4:.5:4 |
  C5:1:5 C4:1:1 C4:1:1 | F4:1:4 G4:.5:5 F4:.5:4 E4:.5:3 D4:.5:2 | E4:1:3 F4:.5:4 E4:.5:3 D4:.5:2 C4:.5:1 |`

export const CURRICULUM: Lesson[] = [
  // ======================= Stage 1 — Discover the keyboard =======================
  {
    id: 'first-tune',
    stage: 1,
    kind: 'play',
    title: 'Your first tune: Hot Cross Buns',
    goal: 'Play a three-note tune with the right hand around middle C.',
    intro: [
      'Middle C is the white key in the very centre of your MiniLab, just left of the middle pair of black keys. Put your right thumb on it, finger 2 on the next white key (D) and finger 3 on the one after (E).',
      'That is all this tune needs. On the flute you made every note with your breath; on the piano a small hammer does it for you. A relaxed, firm press is enough, no force.',
    ],
    tips: [
      'Keep your fingers curved, as if holding a small ball.',
      'In Wait mode the music waits for you. Speed comes later.',
    ],
    bpm: 72,
    timeSig: [4, 4],
    notes: line(
      'R',
      `E4:1:3 D4:1:2 C4:2:1 | E4:1:3 D4:1:2 C4:2:1 |
       C4:.5:1 C4:.5:1 C4:.5:1 C4:.5:1 D4:.5:2 D4:.5:2 D4:.5:2 D4:.5:2 | E4:1:3 D4:1:2 C4:2:1 |`,
    ),
    hands: 'R',
    key: 'C major',
    scale: [0, 2, 4],
    pass: { minAccuracy: 0.8 },
  },
  {
    id: 'mary-five-fingers',
    stage: 1,
    kind: 'play',
    title: 'Five-finger position: Mary Had a Little Lamb',
    goal: 'Use the C five-finger position (C D E F G = fingers 1–5) to play a full 8-bar tune.',
    intro: [
      'Pianists number fingers from the thumb: thumb 1, index 2, middle 3, ring 4, little finger 5. Both hands use the same numbers.',
      'Rest one finger on each key from C to G: that is the C position, and a huge amount of beginner music lives inside it. This tune uses C, D, E and reaches up to G with finger 5.',
      'Notice the shape: bars 1–4 ask a question, bars 5–8 answer it and come home to C. Melodies breathe in phrases, exactly like your flute phrases.',
    ],
    tips: ['Leave finger 4 resting on F even though you never play it.', 'Let the long notes ring for their full length.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: line('R', MARY),
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.8 },
  },
  {
    id: 'left-hand-hello',
    stage: 1,
    kind: 'play',
    title: 'Hello, left hand',
    goal: 'Play in the left-hand C position (C3–G3) with the mirrored finger numbers.',
    intro: [
      'This is the brand-new part for a flute player: your left hand. Put finger 5 on the lowest C of the MiniLab and let fingers 4, 3, 2, 1 fall on D, E, F, G.',
      'Because the hand is a mirror image, going up the keyboard means counting down: 5-4-3-2-1. It feels backwards for a day or two, then it is just normal.',
      'The left hand usually plays the low part: the bass and the harmony underneath the tune. You will meet Hot Cross Buns again down here.',
    ],
    tips: ['Say the finger numbers out loud while you play.', 'Keep the wrist level; do not let it sag below the keys.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: line(
      'L',
      `C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:4:1 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:4:5 |
       E3:1:3 D3:1:4 C3:2:5 | E3:1:3 D3:1:4 C3:2:5 |
       C3:.5:5 C3:.5:5 C3:.5:5 C3:.5:5 D3:.5:4 D3:.5:4 D3:.5:4 D3:.5:4 | E3:1:3 D3:1:4 C3:2:5 |`,
    ),
    hands: 'L',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.8 },
  },
  {
    id: 'black-key-tunes',
    stage: 1,
    kind: 'play',
    title: 'Same tunes, black keys',
    goal: 'Transpose two known tunes onto the black keys and see that a melody is a pattern, not a set of keys.',
    intro: [
      'The black keys come in groups of two and three. Put right-hand fingers 2, 3, 4 on the group of three just below middle C (F♯, G♯, A♯) and finger 5 on the C♯ just above middle C.',
      'Now play Hot Cross Buns and Mary Had a Little Lamb on these keys. Same tunes, same finger shapes, a new home: that is transposition. On flute a new key means new fingerings; on the piano you can literally see the pattern move.',
      'A black key is a sharp of the white key to its left (F♯) or a flat of the one to its right (G♭): one key, two names.',
    ],
    tips: ['Play black keys with the long fingers (2, 3, 4) and stay near the front edge of the white keys.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: line(
      'R',
      `A#3:1:4 G#3:1:3 F#3:2:2 | A#3:1:4 G#3:1:3 F#3:2:2 |
       F#3:.5:2 F#3:.5:2 F#3:.5:2 F#3:.5:2 G#3:.5:3 G#3:.5:3 G#3:.5:3 G#3:.5:3 | A#3:1:4 G#3:1:3 F#3:2:2 |
       A#3:1:4 G#3:1:3 F#3:1:2 G#3:1:3 | A#3:1:4 A#3:1:4 A#3:2:4 | G#3:1:3 G#3:1:3 G#3:2:3 | A#3:1:4 C#4:1:5 C#4:2:5 |
       A#3:1:4 G#3:1:3 F#3:1:2 G#3:1:3 | A#3:1:4 A#3:1:4 A#3:1:4 A#3:1:4 | G#3:1:3 G#3:1:3 A#3:1:4 G#3:1:3 | F#3:4:2 |`,
    ),
    hands: 'R',
    key: 'F# major',
    scale: BLACK_PENTA,
    pass: { minAccuracy: 0.8 },
  },

  // ======================= Stage 2 — Rhythm & coordination =======================
  {
    id: 'au-clair-rhythm',
    stage: 2,
    kind: 'play',
    title: 'Counting long notes: Au clair de la lune',
    goal: 'Hold quarter, half and whole notes for their exact length.',
    intro: [
      'You already know rhythm from the flute. The piano adds one twist: a piano note starts loud and fades, and you cannot swell it with breath. So a whole note has to be held by counting, even while the sound is dying away.',
      'Count "1 2 3 4" out loud. Lift the key exactly when the next note begins, not earlier.',
    ],
    tips: ['Try Rhythm mode with the metronome on.', 'Released early is shown in yellow; aim for none.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: line(
      'R',
      `C4:1:1 C4:1:1 C4:1:1 D4:1:2 | E4:2:3 D4:2:2 | C4:1:1 E4:1:3 D4:1:2 D4:1:2 | C4:4:1 |
       C4:1:1 C4:1:1 C4:1:1 D4:1:2 | E4:2:3 D4:2:2 | C4:1:1 E4:1:3 D4:1:2 D4:1:2 | C4:4:1 |`,
    ),
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
  },
  {
    id: 'mary-both-hands',
    stage: 2,
    kind: 'play',
    title: 'Two hands for the first time',
    goal: 'Add a left-hand bass note on beat 1 of each bar under a known melody.',
    intro: [
      'On flute you only ever play one line. Here your left hand adds a single low note at the start of every bar while the right hand plays Mary Had a Little Lamb.',
      'The left hand plays C (finger 5) under most bars and G (finger 1) where the tune leans on D. Those two notes are the bass of the two most important chords in C major: home (C) and away (G).',
      'Practise the hands separately first if it feels like patting your head and rubbing your tummy. That is normal.',
    ],
    tips: ['Start in Wait mode, then Rhythm mode at a slow tempo.', 'Look ahead: the left hand only moves at bars 3, 4, 7 and 8.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: [
      ...line('R', MARY),
      ...line('L', 'C3:4:5 | C3:4:5 | G3:4:1 | C3:4:5 | C3:4:5 | C3:4:5 | G3:4:1 | C3:4:5 |', { vel: 64 }),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog(MARY_CHORDS),
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
  },
  {
    id: 'black-key-jam',
    stage: 2,
    kind: 'improvise',
    title: 'Black-key jam',
    goal: 'Improvise freely on the five black keys over a gentle backing.',
    intro: [
      'The five black keys form a pentatonic scale, the scale behind folk music all over the world. Over this backing every black key sounds good, so there are no wrong notes.',
      'Think like a flute player: play a short phrase, then breathe (rest). Try repeating a little idea, then changing its ending.',
    ],
    tips: [
      'Use only a few notes at first; three is plenty.',
      'Leave silences. A phrase plus a rest sounds like music; nonstop notes sound like noodling.',
    ],
    bpm: 76,
    timeSig: [4, 4],
    notes: pad(['F#', 'F#', 'D#m', 'D#m', 'F#', 'F#', 'C#', 'F#']),
    hands: 'R',
    key: 'F# major',
    scale: BLACK_PENTA,
    chords: barProg(['F#', 'F#', 'D#m', 'D#m', 'F#', 'F#', 'C#', 'F#']),
    pass: { minAccuracy: 0.8 },
  },
  {
    id: 'jingle-bells-dotted',
    stage: 2,
    kind: 'play',
    title: 'Dotted rhythms: Jingle Bells',
    goal: 'Play dotted-quarter + eighth rhythms with a steady left-hand bass on beat 1.',
    intro: [
      'A dotted quarter lasts one and a half beats, so the eighth note after it arrives late, on the "and" of beat 2. Count "1 2 3-and 4". You have tongued this rhythm a hundred times on the flute.',
      'The left hand still plays one note per bar: C, F, D or G with fingers 5, 2, 4 and 1 of the C position.',
    ],
    tips: ['Loop bars 3–4 and 5–6 until the dotted rhythm feels natural.'],
    bpm: 88,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `E4:1:3 E4:1:3 E4:2:3 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 G4:1:5 C4:1.5:1 D4:.5:2 | E4:4:3 |
         F4:1:4 F4:1:4 F4:1.5:4 F4:.5:4 | F4:1:4 E4:1:3 E4:1:3 E4:.5:3 E4:.5:3 | E4:1:3 D4:1:2 D4:1:2 E4:1:3 | D4:2:2 G4:2:5 |
         E4:1:3 E4:1:3 E4:2:3 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 G4:1:5 C4:1.5:1 D4:.5:2 | E4:4:3 |
         F4:1:4 F4:1:4 F4:1.5:4 F4:.5:4 | F4:1:4 E4:1:3 E4:1:3 E4:.5:3 E4:.5:3 | G4:1:5 G4:1:5 F4:1:4 D4:1:2 | C4:4:1 |`,
      ),
      ...line(
        'L',
        `C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | F3:4:2 | C3:4:5 | D3:4:4 | G3:4:1 |
         C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | F3:4:2 | C3:4:5 | G3:4:1 | C3:4:5 |`,
        { vel: 64 },
      ),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:16 F:4 C:4 D7:4 G:4 C:16 F:4 C:4 G7:4 C:4'),
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
  },
  {
    id: 'mirror-hands',
    stage: 2,
    kind: 'play',
    title: 'Mirror and parallel: hands moving together',
    goal: 'Move both hands at once, first in contrary motion (same fingers), then in parallel (opposite fingers).',
    intro: [
      'Bars 1–4: the hands move away from each other and back, a mirror image. Both hands use the same finger numbers at the same moment, so it feels easy.',
      'Bars 5–8: both hands go the same direction. Now the fingers are opposite (right 1 with left 5). This is the real coordination workout, and the reason pianists practise slowly.',
    ],
    tips: ['If bars 5–8 fall apart, play them in Wait mode three times, then try Rhythm mode again.'],
    bpm: 66,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:4:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1 |
         C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:4:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1 |`,
      ),
      ...line(
        'L',
        `G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:4:5 | C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:4:1 |
         C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:4:1 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:4:5 |`,
      ),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
  },

  // ================ Stage 3 — Scales, intervals & patterns (ear training) ================
  {
    id: 'c-major-scale',
    stage: 3,
    kind: 'play',
    title: 'C major scale: the thumb tuck',
    goal: 'Play a one-octave C major scale with the right hand, passing the thumb under after finger 3.',
    intro: [
      'You have five fingers and the scale has eight notes, so pianists tuck the thumb under: C D E with 1 2 3, then the thumb slides under to F and you carry on 1 2 3 4 5. On the way down, finger 3 crosses over the thumb onto E.',
      'Why does C major sound "home"? Its steps follow the pattern whole, whole, half, whole, whole, whole, half. The two half steps (E–F and B–C) have no black key between them. Every major scale uses this same pattern from a different starting key.',
    ],
    tips: ['Move the thumb under early, while finger 3 is still playing E.', 'Keep the wrist and elbow quiet; only the thumb travels.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: line(
      'R',
      `C4:1:1 D4:1:2 E4:1:3 F4:1:1 | G4:1:2 A4:1:3 B4:1:4 C5:1:5 | B4:1:4 A4:1:3 G4:1:2 F4:1:1 | E4:1:3 D4:1:2 C4:2:1 |
       C4:.5:1 D4:.5:2 E4:.5:3 F4:.5:1 G4:.5:2 A4:.5:3 B4:.5:4 C5:.5:5 | B4:.5:4 A4:.5:3 G4:.5:2 F4:.5:1 E4:.5:3 D4:.5:2 C4:1:1 |`,
    ),
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },
  {
    id: 'c-major-scale-left',
    stage: 3,
    kind: 'play',
    title: 'C major scale, left hand',
    goal: 'Play the C major scale with the left hand, crossing finger 3 over the thumb.',
    intro: [
      'The left hand is the mirror: going up, play C D E F G with 5 4 3 2 1, then finger 3 crosses over the thumb onto A, and B C are 2 1. Coming down, the thumb tucks under after G.',
      'Same scale, opposite mechanics. This is why left and right hand scales are practised separately at first.',
    ],
    tips: ['Watch the crossover point (G to A) in slow motion before playing in time.'],
    bpm: 66,
    timeSig: [4, 4],
    notes: line(
      'L',
      `C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:1:1 A3:1:3 B3:1:2 C4:1:1 | B3:1:2 A3:1:3 G3:1:1 F3:1:2 | E3:1:3 D3:1:4 C3:2:5 |`,
    ),
    hands: 'L',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },
  {
    id: 'intervals-by-ear',
    stage: 3,
    kind: 'echo',
    title: 'Ear training: intervals',
    goal: 'Hear an interval from middle C and find the second note by ear.',
    intro: [
      'An interval is the distance between two notes. You already hear them as a flute player; now attach names. Major 2nd: a plain step, as at the start of a scale. Major 3rd: "Oh when the saints". Perfect 4th: the opening of Amazing Grace. Perfect 5th: "Twinkle, twinkle". Octave: the start of "Somewhere Over the Rainbow".',
      'The app plays a short phrase that starts on middle C. Sing it back in your head, then play it. The last phrases have three to five notes.',
    ],
    tips: ['Sing or hum the phrase before you touch the keys.', 'Every phrase starts on middle C (or ends on it).'],
    bpm: 80,
    timeSig: [4, 4],
    notes: [],
    phrases: [
      [60, 62],
      [60, 64],
      [60, 67],
      [60, 72],
      [60, 65],
      [67, 60],
      [60, 64, 67],
      [60, 62, 64, 67, 60],
    ],
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    pass: { minAccuracy: 0.75 },
  },
  {
    id: 'sequences',
    stage: 3,
    kind: 'play',
    title: 'Patterns that climb: sequences',
    goal: 'Play a four-note motif repeated one step higher each bar, then back down.',
    intro: [
      'Composers rarely invent a new idea every bar. They take a small motif and repeat it a step higher or lower: a sequence. Listen for it in Vivaldi, Bach and film music.',
      'Here the motif is "step up, step up, step back". Your hand stays in C position the whole time; only the starting finger changes.',
    ],
    tips: ['Name the motif in your head ("up, up, back") instead of reading single notes.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4:1:1 D4:1:2 E4:1:3 D4:1:2 | D4:1:2 E4:1:3 F4:1:4 E4:1:3 | E4:1:3 F4:1:4 G4:1:5 F4:1:4 | G4:4:5 |
         G4:1:5 F4:1:4 E4:1:3 F4:1:4 | F4:1:4 E4:1:3 D4:1:2 E4:1:3 | E4:1:3 D4:1:2 C4:1:1 D4:1:2 | C4:4:1 |`,
      ),
      ...line('L', 'C3:4 | G3:4 | C3:4 | C3:4 | C3:4 | G3:4 | C3:4 | C3:4 |', { vel: 58 }),
    ],
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 G:4 C:4 C:4 C:4 G:4 C:4 C:4'),
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },
  {
    id: 'a-minor-scale',
    stage: 3,
    kind: 'play',
    title: 'A minor: same keys, different home',
    goal: 'Play the A natural minor and A harmonic minor scales and hear the difference.',
    intro: [
      'Start the white-key scale on A instead of C and it turns sad. A minor uses exactly the same keys as C major (it is C major\'s "relative minor"); only the home note changed.',
      'Bars 5–8 raise G to G♯: the harmonic minor. That G♯ is one half step below A and pulls strongly home. It is the sound of a lot of classical minor music.',
    ],
    tips: ['Same fingering as C major: thumb tuck after finger 3.', 'Listen to the G♯ to A in bar 6: that pull is called a leading tone.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: line(
      'R',
      `A3:1:1 B3:1:2 C4:1:3 D4:1:1 | E4:1:2 F4:1:3 G4:1:4 A4:1:5 | G4:1:4 F4:1:3 E4:1:2 D4:1:1 | C4:1:3 B3:1:2 A3:2:1 |
       A3:1:1 B3:1:2 C4:1:3 D4:1:1 | E4:1:2 F4:1:3 G#4:1:4 A4:1:5 | G#4:1:4 F4:1:3 E4:1:2 D4:1:1 | C4:1:3 B3:1:2 A3:2:1 |`,
    ),
    hands: 'R',
    key: 'A minor',
    scale: A_MINOR,
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },

  // ======================= Stage 4 — Chords & harmony =======================
  {
    id: 'first-triads',
    stage: 4,
    kind: 'play',
    title: 'Your first chords: C, F and G',
    goal: 'Play root-position triads with the left hand (fingers 5-3-1).',
    intro: [
      'A triad is three notes stacked in thirds: skip a key, play, skip a key, play. C–E–G is C major. On the flute you could only hint at harmony one note at a time; on the piano you can play it.',
      'C, F and G are chords I, IV and V of C major. With just these three you can accompany hundreds of folk songs. G (V) wants to go home to C (I): you will hear that pull in bar 3 to 4.',
    ],
    tips: ['Press all three keys at exactly the same moment, like one sound.', 'Fingers 5-3-1 for every chord; the hand shape never changes, it only moves.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: line(
      'L',
      `C3+E3+G3:4:5+3+1 | F3+A3+C4:4:5+3+1 | G3+B3+D4:4:5+3+1 | C3+E3+G3:4:5+3+1 |
       C3+E3+G3:2:5+3+1 F3+A3+C4:2:5+3+1 | C3+E3+G3:2:5+3+1 G3+B3+D4:2:5+3+1 | F3+A3+C4:2:5+3+1 G3+B3+D4:2:5+3+1 | C3+E3+G3:4:5+3+1 |`,
    ),
    hands: 'L',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 F:4 G:4 C:4 C:2 F:2 C:2 G:2 F:2 G:2 C:4'),
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },
  {
    id: 'inversions',
    stage: 4,
    kind: 'play',
    title: 'Inversions: the lazy hand moves least',
    goal: 'Play C, F and G as inversions so the right hand barely moves.',
    intro: [
      'An inversion is the same chord with its notes in a different order. F–A–C can also be played C–F–A, and G–B–D as B–D–G. The chord keeps its name; the bottom note changes.',
      'Why bother? Keep the shared notes (C stays put from C to F, G stays from C to G) and move the others by a step. Your hand barely moves, and the chords flow into each other. This is the beginning of voice leading. The left hand (auto) plays the roots so you still hear the real chord.',
    ],
    tips: ['Notice which finger stays on the same key between chords.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4+E4+G4:4:1+3+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5 | C4+E4+G4:4:1+3+5 |
         C4+E4+G4:2:1+3+5 C4+F4+A4:2:1+3+5 | B3+D4+G4:2:1+2+5 C4+E4+G4:2:1+3+5 | C4+F4+A4:2:1+3+5 B3+D4+G4:2:1+2+5 | C4+E4+G4:4:1+3+5 |`,
      ),
      ...line('L', 'C3:4 | F3:4 | G3:4 | C3:4 | C3:2 F3:2 | G3:2 C3:2 | F3:2 G3:2 | C3:4 |', { vel: 60 }),
    ],
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 F:4 G:4 C:4 C:2 F:2 G:2 C:2 F:2 G:2 C:4'),
    pass: { minAccuracy: 0.88, minTiming: 0.75 },
  },
  {
    id: 'four-chords',
    stage: 4,
    kind: 'play',
    title: 'The four-chord progression',
    goal: 'Play I–V–vi–IV (C–G–Am–F) with right-hand inversions over left-hand roots.',
    intro: [
      'C, G, A minor, F: in Roman numerals I, V, vi, IV. This loop is under a huge share of pop songs, and plenty of piano ballads.',
      'Am is the first minor chord here: A–C–E, a darker colour built from the same white keys. Your right hand uses the inversion trick so it only moves a step at a time; the left hand plays the root of each chord.',
    ],
    tips: ['Practise right hand alone first; the left hand only plays one note per bar.', 'Use Loop mode on bars 1–4 once you have it.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4+E4+G4:4:1+3+5 | B3+D4+G4:4:1+2+5 | C4+E4+A4:4:1+2+5 | C4+F4+A4:4:1+3+5 |
         C4+E4+G4:2:1+3+5 C4+E4+G4:2:1+3+5 | B3+D4+G4:2:1+2+5 B3+D4+G4:2:1+2+5 | C4+E4+A4:2:1+2+5 C4+E4+A4:2:1+2+5 | C4+F4+A4:2:1+3+5 C4+F4+A4:2:1+3+5 |
         C4+E4+G4:4:1+3+5 |`,
      ),
      ...line('L', 'C3:4:5 | G3:4:1 | A3:4:1 | F3:4:3 | C3:4:5 | G3:4:1 | A3:4:1 | F3:4:3 | C3:4:5 |', { vel: 64 }),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 G:4 Am:4 F:4 C:4 G:4 Am:4 F:4 C:4'),
    pass: { minAccuracy: 0.88, minTiming: 0.75 },
  },
  {
    id: 'arpeggios',
    stage: 4,
    kind: 'play',
    title: 'Arpeggios: chords one note at a time',
    goal: 'Break chords into rising arpeggios with the right hand.',
    intro: [
      'An arpeggio is a chord played one note at a time. As a flute player you already know them: it is how a single-line instrument spells out harmony. On the piano the notes keep ringing, so the chord builds up in the air.',
      'Each bar is one chord from the four-chord family, in the inversion closest to middle C. The left hand (auto) plays the roots.',
    ],
    tips: [
      'Fingering: 1-2-3-5 when the wide gap is at the top, 1-2-4-5 when it is in the middle.',
      'Let the hand open like a fan; do not jump from note to note.',
    ],
    bpm: 76,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4:1:1 E4:1:2 G4:1:3 C5:1:5 | C4:1:1 E4:1:2 A4:1:4 C5:1:5 | C4:1:1 F4:1:2 A4:1:3 C5:1:5 | B3:1:1 D4:1:2 G4:1:4 B4:1:5 |
         C4:1:1 E4:1:2 G4:1:3 C5:1:5 | C4:1:1 F4:1:2 A4:1:3 C5:1:5 | B3:1:1 D4:1:2 G4:1:4 B4:1:5 | C4+E4+G4+C5:4:1+2+3+5 |`,
      ),
      ...line('L', 'C3:4 | A3:4 | F3:4 | G3:4 | C3:4 | F3:4 | G3:4 | C3:4 |', { vel: 60 }),
    ],
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 Am:4 F:4 G:4 C:4 F:4 G:4 C:4'),
    pass: { minAccuracy: 0.88, minTiming: 0.75 },
  },
  {
    id: 'accompaniment',
    stage: 4,
    kind: 'play',
    title: 'Accompany a melody: broken chords',
    goal: 'Play a broken-chord left-hand pattern under a melody the app plays.',
    intro: [
      'Now the left hand becomes a real accompanist. Instead of one bass note, it walks through the chord: bass, top, middle, top. The app plays Mary Had a Little Lamb on top.',
      'C bars: C–G–E–G (fingers 5-1-3-1). G bars: D–G–F–G (4-1-2-1). That second shape is a G7 chord squeezed into your C position: G, F and D without B. It still pulls home to C.',
    ],
    tips: ['Keep the bass note (finger 5 or 4) slightly stronger and the thumb notes light.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: [
      ...line('R', MARY, { vel: 84 }),
      ...line(
        'L',
        `C3:1:5 G3:1:1 E3:1:3 G3:1:1 | C3:1:5 G3:1:1 E3:1:3 G3:1:1 | D3:1:4 G3:1:1 F3:1:2 G3:1:1 | C3:1:5 G3:1:1 E3:1:3 G3:1:1 |
         C3:1:5 G3:1:1 E3:1:3 G3:1:1 | C3:1:5 G3:1:1 E3:1:3 G3:1:1 | D3:1:4 G3:1:1 F3:1:2 G3:1:1 | C3+E3+G3:4:5+3+1 |`,
        { vel: 66 },
      ),
    ],
    hands: 'L',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 C:4 G7:4 C:4 C:4 C:4 G7:4 C:4'),
    pass: { minAccuracy: 0.88, minTiming: 0.75 },
  },
  {
    id: 'voice-leading',
    stage: 4,
    kind: 'play',
    title: 'Why G7 goes home: voice leading',
    goal: 'Play I–vi–ii–V7–I with smooth voice leading and hear the tendency tones resolve.',
    intro: [
      'C – Am – Dm – G7 – C is the classic cadence. Treat the three right-hand notes as three singers: each moves as little as possible, often not at all.',
      'G7 contains B and F. B wants to rise a half step to C; F wants to fall a half step to E. When they do, in the last bar, you hear "home". That is the why behind the V7–I cadence.',
    ],
    tips: ['Play the right hand alone and listen to the top voice: G, A, A, G, G.', 'Hold each chord its full length; the next one should connect without a gap.'],
    bpm: 66,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4+E4+G4:4:1+3+5 | C4+E4+A4:4:1+2+5 | D4+F4+A4:4:1+3+5 | B3+F4+G4:4:1+4+5 |
         C4+E4+G4:4:1+3+5 | C4+E4+A4:4:1+2+5 | D4+F4+A4:2:1+3+5 B3+F4+G4:2:1+4+5 | C4+E4+G4:4:1+3+5 |`,
      ),
      ...line('L', 'C3:4:5 | A3:4:1 | D3:4:4 | G3:4:1 | C3:4:5 | A3:4:1 | D3:2:4 G3:2:1 | C3:4:5 |', { vel: 64 }),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 Am:4 Dm:4 G7:4 C:4 Am:4 Dm:2 G7:2 C:4'),
    pass: { minAccuracy: 0.88, minTiming: 0.75 },
  },

  // ======================= Stage 5 — Playing real music =======================
  {
    id: 'ode-to-joy',
    stage: 5,
    kind: 'play',
    title: 'Ode to Joy (Beethoven)',
    goal: 'Play the Ode to Joy theme with a quiet left-hand bass, shaping two phrases.',
    intro: [
      'Beethoven\'s Ninth Symphony theme moves almost only by step, which is why it fits in one hand position. Two four-bar phrases: the first ends on D (unfinished), the second lands on C (finished).',
      'Balance is the new skill: the melody sings, the left hand is quieter. On flute your breath shaped a phrase; on piano you shape it with weight, a little more towards the middle of the phrase, a little less at the end.',
    ],
    tips: ['Left hand softer than right hand, always.', 'The dotted rhythm in bars 4 and 8: hold the dot, then a quick short note.'],
    bpm: 84,
    timeSig: [4, 4],
    notes: [
      ...line('R', 'E4:1:3 E4:1:3 F4:1:4 G4:1:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 |', { vel: 78 }),
      ...line('R', 'C4:1:1 C4:1:1 D4:1:2 E4:1:3 | E4:1.5:3 D4:.5:2 D4:2:2 |', { start: 8, vel: 72 }),
      ...line('R', 'E4:1:3 E4:1:3 F4:1:4 G4:1:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 |', { start: 16, vel: 86 }),
      ...line('R', 'C4:1:1 C4:1:1 D4:1:2 E4:1:3 | D4:1.5:2 C4:.5:1 C4:2:1 |', { start: 24, vel: 74 }),
      ...line('L', 'C3:4:5 | G3:4:1 | C3:4:5 | G3:4:1 | C3:4:5 | G3:4:1 | C3:4:5 | G3:2:1 C3:2:5 |', { vel: 58 }),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:4 G:4 C:4 G:4 C:4 G:4 C:4 G:2 C:2'),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },
  {
    id: 'twinkle',
    stage: 5,
    kind: 'play',
    title: 'Twinkle, Twinkle, Little Star',
    goal: 'Play an ABA melody with a left hand that changes chord in the middle of the bar.',
    intro: [
      'This French tune ("Ah vous dirai-je, maman") was famous enough that Mozart wrote twelve variations on it. Its form is A–B–A: a statement, a contrasting middle, and a return.',
      'The left hand now plays two notes per bar, following the harmony: C, F and G. Play the middle section (bars 5–8) a little softer, like a contrast, then return to full tone.',
    ],
    tips: ['Bar 1: the leap C to G is a perfect fifth; let finger 4 land on G without looking.', 'Loop bars 5–6 to get the soft middle even.'],
    bpm: 84,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4:1:1 C4:1:1 G4:1:4 G4:1:4 | A4:1:5 A4:1:5 G4:2:4 | F4:1:4 F4:1:4 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 C4:2:1 |`,
        { vel: 80 },
      ),
      ...line(
        'R',
        `G4:1:5 G4:1:5 F4:1:4 F4:1:4 | E4:1:3 E4:1:3 D4:2:2 | G4:1:5 G4:1:5 F4:1:4 F4:1:4 | E4:1:3 E4:1:3 D4:2:2 |`,
        { start: 16, vel: 64 },
      ),
      ...line(
        'R',
        `C4:1:1 C4:1:1 G4:1:4 G4:1:4 | A4:1:5 A4:1:5 G4:2:4 | F4:1:4 F4:1:4 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 C4:2:1 |`,
        { start: 32, vel: 80 },
      ),
      ...line(
        'L',
        `C3:4:5 | F3:2:2 C3:2:5 | F3:2:2 C3:2:5 | G3:2:1 C3:2:5 |
         C3:2:5 G3:2:1 | C3:2:5 G3:2:1 | C3:2:5 G3:2:1 | C3:2:5 G3:2:1 |
         C3:4:5 | F3:2:2 C3:2:5 | F3:2:2 C3:2:5 | G3:2:1 C3:2:5 |`,
        { vel: 58 },
      ),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog(
      'C:4 F:2 C:2 F:2 C:2 G:2 C:2 C:2 G7:2 C:2 G:2 C:2 G7:2 C:2 G:2 C:4 F:2 C:2 F:2 C:2 G:2 C:2',
    ),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },
  {
    id: 'frere-jacques',
    stage: 5,
    kind: 'play',
    title: 'Frère Jacques over a drone',
    goal: 'Play a round melody with eighth notes over a sustained left-hand open fifth.',
    intro: [
      'Frère Jacques is a round: the same melody fits against itself when a second voice starts two bars later. Here your left hand holds a drone, C and G together, like bagpipes or a hurdy-gurdy.',
      'Each idea is played twice. Make the second time slightly different (softer, or more connected) so the repeat has a reason. In bars 5–6 the hand stretches: G with finger 4, A with 5, and skips D.',
    ],
    tips: ['Bars 7–8: move the hand down so the thumb plays the low G, then finger 4 is on C.', 'Afterwards, record it and play along with your own recording, two bars late: a round.'],
    bpm: 88,
    timeSig: [4, 4],
    notes: [
      ...line(
        'R',
        `C4:1:1 D4:1:2 E4:1:3 C4:1:1 | C4:1:1 D4:1:2 E4:1:3 C4:1:1 | E4:1:3 F4:1:4 G4:2:5 | E4:1:3 F4:1:4 G4:2:5 |
         G4:.5:4 A4:.5:5 G4:.5:4 F4:.5:3 E4:1:2 C4:1:1 | G4:.5:4 A4:.5:5 G4:.5:4 F4:.5:3 E4:1:2 C4:1:1 |
         C4:1:4 G3:1:1 C4:2:4 | C4:1:4 G3:1:1 C4:2:4 |`,
      ),
      // drone: no G3 in bars 7–8, where the right hand plays it
      ...line('L', 'C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3:4:5 | C3:4:5 |', {
        vel: 56,
      }),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:32'),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },
  {
    id: 'greensleeves',
    stage: 5,
    kind: 'play',
    title: 'Greensleeves (opening)',
    goal: 'Play a lyrical minor melody in 3/4 with dotted rhythms and legato phrasing.',
    intro: [
      'An English tune from the 1500s, in A minor and in three beats per bar: count "1 2 3", with the strongest weight on 1. It starts with a pickup: the first A comes on beat 3, before the first full bar.',
      'Listen for G and G♯. The plain G gives the old, modal colour; the G♯ near each phrase ending is the leading tone from the A minor lesson, pulling home to A.',
      'This one is right hand only. Make it sing: connect every note to the next (legato), the way you would slur it on the flute.',
    ],
    tips: ['Dotted rhythm (bars 2, 4, 6, 10, 12–14): long-short, like a gentle limp.', 'Your hand shifts down for the low E in bar 8; prepare it during the long B in bar 7.'],
    bpm: 84,
    timeSig: [3, 4],
    countIn: 3,
    notes: [
      ...line(
        'R',
        `r:2 A3:1:1 | C4:2:2 D4:1:3 | E4:1.5:4 F4:.5:5 E4:1:4 | D4:2:3 B3:1:2 | G3:1.5:1 A3:.5:2 B3:1:3 |
         C4:2:4 A3:1:2 | A3:1.5:2 G#3:.5:1 A3:1:2 | B3:2:3 G#3:1:1 | E3:2:1 A3:1:1 |`,
        { bar: 3, vel: 74 },
      ),
      ...line(
        'R',
        `C4:2:2 D4:1:3 | E4:1.5:4 F4:.5:5 E4:1:4 | D4:2:3 B3:1:2 | G3:1.5:1 A3:.5:2 B3:1:3 |
         C4:1.5:4 B3:.5:3 A3:1:2 | G#3:1.5:2 F#3:.5:1 G#3:1:2 | A3:3:3 |`,
        { start: 27, bar: 3, vel: 70 },
      ),
    ],
    hands: 'R',
    key: 'A minor',
    scale: A_MINOR,
    chords: prog('Am:3 Am:3 C:3 G:3 Em:3 Am:3 Am:3 E:3 E:3 Am:3 C:3 G:3 Em:3 Am:3 E:3 Am:3'),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },
  {
    id: 'minuet-in-g',
    stage: 5,
    kind: 'play',
    title: 'Minuet in G (Petzold), played in C',
    goal: 'Play a 16-bar Baroque dance with a one-note-per-bar left hand.',
    intro: [
      'This minuet from Anna Magdalena Bach\'s notebook (by Christian Petzold) is in G major. A 25-key keyboard cannot fit it in G without octave switching, so here it is transposed to C: every interval, so every shape, is identical.',
      'A minuet is a dance in three: step on beat 1, lighter on 2 and 3. Play the quarter notes slightly detached and the eighth-note runs smoothly. The left hand walks C–E–F–E–D–C–G, a real bass line.',
      'Bars 1–8 end on D, a half cadence: a question. Bars 9–16 repeat the opening and end on C: the answer.',
    ],
    tips: ['Bar 1 and 2: finger 5 on the high G, thumb on the C below.', 'Bar 4: the octave leap C5 to C4 is 5 to 1; let the hand fly, do not look down.'],
    bpm: 80,
    timeSig: [3, 4],
    notes: [
      ...line('R', `${MINUET_A} B3:1:1 C4:.5:2 D4:.5:3 E4:.5:4 C4:.5:2 | D4:3:3 |`, { bar: 3, vel: 80 }),
      ...line('R', `${MINUET_A} D4:1:3 E4:.5:4 D4:.5:3 C4:.5:2 B3:.5:1 | C4:3:2 |`, { start: 24, bar: 3, vel: 76 }),
      ...line(
        'L',
        `C3:3:5 | E3:3:3 | F3:3:2 | E3:3:3 | D3:3:4 | C3:3:5 | G3:3:1 | G3:3:1 |
         C3:3:5 | E3:3:3 | F3:3:2 | E3:3:3 | D3:3:4 | C3:3:5 | G3:3:1 | C3:3:5 |`,
        { bar: 3, vel: 60 },
      ),
    ],
    hands: 'both',
    key: 'C major',
    scale: C_MAJOR,
    chords: prog('C:3 C:3 F:3 C:3 Dm:3 C:3 G:3 G:3 C:3 C:3 F:3 C:3 Dm:3 C:3 G:3 C:3'),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },
  {
    id: 'cinematic-ostinato',
    stage: 5,
    kind: 'play',
    title: 'Cinematic ostinato (film-score style)',
    goal: 'Keep a steady right-hand arpeggio going over slow bass notes, and build it from soft to loud.',
    intro: [
      'Many space and film scores – the Interstellar theme is a famous example – are built from an ostinato: a short pattern repeated like a ticking clock, while the harmony underneath slowly changes. This is an original piece in that style (the real film themes are copyrighted, so they are not included here).',
      'The piece lives in your right hand: one shape the whole time – thumb, middle finger, little finger, middle finger – and only the thumb moves (E, F, E, D). The app plays the slow left-hand bass for you.',
      'Each hand can be practised on its own: in Wait, Rhythm or Loop mode, use the Right / Left / Both switch at the top. When the right hand feels easy, try Left alone (one long note or fifth per bar), then Both – two independent jobs at once, the thing a flute can never do.',
      'The chords are Am–F–C–G, then Am–F–G–Am. That last move, i–VI–VII–i, is the "epic" minor cadence you hear in countless film scores: G does not pull home like a dominant, it lifts you there.',
      'A piano note cannot swell like a flute note once it sounds. So the crescendo comes from each new note being a little firmer than the last: whisper the first bars, open up in bar 5, peak in bar 7, then land.',
    ],
    tips: [
      'Right hand first, in Wait mode. Then Left alone, then Both – use the hand switch at the top.',
      'Keep every eighth note exactly even – the steadiness is what makes it hypnotic.',
      'If you have a sustain pedal in the MiniLab\'s pedal jack, press it at each new bar and lift-and-press at the next one.',
    ],
    bpm: 66,
    timeSig: [4, 4],
    notes: [
      ...line('R', `${ostinato('E4', 'A4', 'C5', 3)} ${ostinato('F4', 'A4', 'C5', 3)}`, { vel: 46 }),
      ...line('R', `${ostinato('E4', 'G4', 'C5', 2)} ${ostinato('D4', 'G4', 'B4', 3)}`, { start: 8, vel: 56 }),
      ...line('R', `${ostinato('E4', 'A4', 'C5', 3)} ${ostinato('F4', 'A4', 'C5', 3)}`, { start: 16, vel: 72 }),
      ...line('R', `${ostinato('D4', 'G4', 'B4', 3)} E4+A4+C5:4:1+3+5:70 |`, { start: 24, vel: 88 }),
      ...line(
        'L',
        `A3:4:1 | F3:4:2 | C3:4:5 | G3:4:1 |
         E3+A3:4:3+1 | F3+C4:4:5+1 | D3+G3:4:4+1 | E3+A3:4:3+1 |`,
        { vel: 52 },
      ),
    ],
    hands: 'R', // the right-hand line is the lesson; Left and Both are optional via the hand switch
    key: 'A minor',
    scale: A_MINOR,
    chords: prog('Am:4 F:4 C:4 G:4 Am:4 F:4 G:4 Am:4'),
    pass: { minAccuracy: 0.9, minTiming: 0.8 },
  },

  // ================== Stage 6 — Improvisation & composition ==================
  {
    id: 'pentatonic-four-chords',
    stage: 6,
    kind: 'improvise',
    title: 'Pentatonic melodies over four chords',
    goal: 'Improvise with the C major pentatonic scale over I–V–vi–IV.',
    intro: [
      'C major pentatonic is C D E G A: the major scale without F and B, the two notes that can clash. It is the black-key jam moved to the white keys.',
      'The backing plays C–G–Am–F. Try landing on a note of the current chord on beat 1 of each bar (C or E over C, G or D over G, A or C over Am, A or C over F). That is how melodies "fit" harmony.',
    ],
    tips: ['Copy the rhythm of a tune you know, but use your own notes.', 'End your last phrase on C.'],
    bpm: 84,
    timeSig: [4, 4],
    notes: pad(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F']),
    hands: 'R',
    key: 'C major',
    scale: C_PENTA,
    chords: barProg(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F']),
    pass: { minAccuracy: 0.85 },
  },
  {
    id: 'question-answer',
    stage: 6,
    kind: 'improvise',
    title: 'Question and answer',
    goal: 'Improvise a 4-bar question that ends away from home and a 4-bar answer that ends on C.',
    intro: [
      'Most melodies are conversations. The question (bars 1–4) ends on the G chord, so finish it on G, B or D: it sounds open. The answer (bars 5–8) starts like the question but ends on C over the C chord: closed.',
      'You heard this in Mary Had a Little Lamb, Ode to Joy and the Minuet. Now you are the composer.',
    ],
    tips: ['Make the answer begin with the same two or three notes as the question.', 'Play it three times; keep what you like and change one thing each time.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: pad(['C', 'F', 'C', 'G', 'C', 'F', 'G', 'C']),
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    chords: barProg(['C', 'F', 'C', 'G', 'C', 'F', 'G', 'C']),
    pass: { minAccuracy: 0.85 },
  },
  {
    id: 'minor-mood',
    stage: 6,
    kind: 'improvise',
    title: 'Minor mood',
    goal: 'Improvise in A natural minor over Am–F–C–G and feel how the home note changes the mood.',
    intro: [
      'Same white keys as C major, but A is home now. Over Am–F–C–G the music sounds wistful or cinematic, the colour of a lot of film and game soundtracks.',
      'Slow notes work well here. Lean on A, C and E (the Am chord), and let a phrase come to rest on A at the end.',
    ],
    tips: ['Try long notes and wide leaps; they sound expressive in minor.', 'Repeat a 2-bar idea, starting it one step lower the second time (a sequence).'],
    bpm: 72,
    timeSig: [4, 4],
    notes: pad(['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am']),
    hands: 'R',
    key: 'A minor',
    scale: A_MINOR,
    chords: barProg(['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am']),
    pass: { minAccuracy: 0.85 },
  },
  {
    id: 'twelve-bar-blues',
    stage: 6,
    kind: 'improvise',
    title: '12-bar blues in C',
    goal: 'Improvise with the C blues scale over a boogie-woogie left hand.',
    intro: [
      'The 12-bar blues is three lines of four bars: C7 for four bars, F7 for two and back to C7 for two, then G7, F7, C7, G7. It is the backbone of blues, jazz and rock and roll.',
      'The blues scale is C E♭ F F♯ G B♭. The "blue notes" E♭ and F♯ clash on purpose; slide off them into a neighbour (E♭ to E, F♯ to G) and they sound just right.',
    ],
    tips: ['Use the same short riff over C7 and over F7: the chord change makes it sound new.', 'Swing it: play pairs of eighths long-short.'],
    bpm: 92,
    timeSig: [4, 4],
    notes: line(
      'L',
      ['C', 'C', 'C', 'C', 'F', 'F', 'C', 'C', 'G', 'F', 'C', 'G'].map((c) => BOOGIE[c]).join(' '),
      { vel: 62 },
    ),
    hands: 'R',
    key: 'C major',
    scale: C_BLUES,
    chords: prog('C7:16 F7:8 C7:8 G7:4 F7:4 C7:4 G7:4'),
    pass: { minAccuracy: 0.85 },
  },
  {
    id: 'compose-eight-bars',
    stage: 6,
    kind: 'improvise',
    title: 'Compose your first 8 bars',
    goal: 'Build a complete 8-bar melody from one motif, then record and keep it.',
    intro: [
      'Composing is improvising with a memory. Pick a motif of 3 or 4 notes. Bars 1–2: play it. Bars 3–4: repeat it, or move it up a step (a sequence). Bars 5–6: change it. Bars 7–8: come home to C.',
      'Use everything so far: chord tones on strong beats, a question that ends open, an answer that ends on C. Record your best take in Create and give it a name. That is your first piece.',
    ],
    tips: ['Same motif, different ending, is the oldest trick in music.', 'Sing your idea first; if you can sing it, it is a melody.'],
    bpm: 76,
    timeSig: [4, 4],
    notes: pad(['C', 'Am', 'F', 'G', 'C', 'Am', 'G', 'C']),
    hands: 'R',
    key: 'C major',
    scale: C_MAJOR,
    chords: barProg(['C', 'Am', 'F', 'G', 'C', 'Am', 'G', 'C']),
    pass: { minAccuracy: 0.85 },
  },

  // ======================= Stage 7 — Pads, bends & grooves =======================
  // A side track that opens after the first rhythm lesson: the MiniLab's pads and touch strips.
  {
    id: 'pads-first-beat',
    stage: 7,
    kind: 'play',
    title: 'Meet the pads: your first beat',
    goal: 'Play the basic rock beat: kick on 1 and 3, snare on 2 and 4, then add the hi-hat.',
    intro: [
      'The 8 pads on your MiniLab are a drum kit here. Pad 1 is the kick (the big low drum), pad 2 the snare, pad 3 the closed hi-hat. The screen shows them to the right of the keyboard. No MiniLab handy? Keys 1–8 on the computer are the pads.',
      'Almost every pop and rock song stands on this pattern: kick on beats 1 and 3, snare on 2 and 4. The snare on 2 and 4 is called the backbeat – it is what makes people nod their heads.',
      'Bars 1–2 are kick and snare only (left hand). In bars 3–4 your right hand adds the hi-hat on every eighth note: count "1 and 2 and 3 and 4 and".',
    ],
    tips: ['Tap the pads with relaxed fingertips, like drumming on a table.', 'Let the hi-hat be the steady clock; the kick and snare sit on top of it.'],
    bpm: 80,
    timeSig: [4, 4],
    notes: groove({
      K: 'x...x... | x...x... | x...x... | x...x...',
      S: '..x...x. | ..x...x. | ..x...x. | ..x...x.',
      H: '........ | ........ | xxxxxxxx | xxxxxxxx',
    }),
    hands: 'both',
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
    unlockAfter: 'au-clair-rhythm',
  },
  {
    id: 'pads-and-chords',
    stage: 7,
    kind: 'play',
    title: 'Beat in one hand, chords in the other',
    goal: 'Keep kick and snare going on the pads with the left hand while the right hand plays the four-chord loop.',
    intro: [
      'This is how a one-person band works: the left hand drums, the right hand plays harmony. Each chord lasts a whole bar, so the right hand only moves four times while the beat keeps going.',
      'The chords are the famous loop C – Am – F – G. Notice how little your hand moves: C stays under your thumb the whole time for the first three chords, and only the G chord slides down to B and D. That is voice leading – the shortest path between chords.',
      'Try each hand alone first (use the Right / Left switch at the top), then both together in Wait mode.',
    ],
    tips: ['Hold each chord for the whole bar while the left hand keeps drumming.', 'If it falls apart, slow the tempo down – coordination comes before speed.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: [
      ...line('R', `C4+E4+G4:4:1+3+5 | C4+E4+A4:4:1+2+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5 |
                    C4+E4+G4:4:1+3+5 | C4+E4+A4:4:1+2+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5 |`),
      ...groove({
        K: 'x...x... | x...x... | x...x... | x...x... | x...x... | x...x... | x...x... | x...x...',
        S: '..x...x. | ..x...x. | ..x...x. | ..x...x. | ..x...x. | ..x...x. | ..x...x. | ..x...x.',
      }),
    ],
    hands: 'both',
    key: 'C major',
    chords: barProg(['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G']),
    pass: { minAccuracy: 0.85, minTiming: 0.7 },
  },
  {
    id: 'offbeat-groove',
    stage: 7,
    kind: 'play',
    title: 'Groove on the offbeat',
    goal: 'Play a hip-hop style groove where the kick lands between the beats.',
    intro: [
      'A groove feels "funky" when some notes land on the "and" between beats. Here the second kick comes on the "and" of 2 – just before the snare – and in bars 2 and 4 there is an extra kick on the "and" of 3.',
      'At the end of bars 2 and 4 the right hand opens the hi-hat (pad 4) on the last "and". It gives the bar a little lift into the next one.',
      'Count out loud: "1 and 2 AND 3 and 4 and". The capital AND is the sneaky kick.',
    ],
    tips: ['Loop bars 1–2 until the offbeat kick feels natural.', 'Keep the hi-hat perfectly even – everything else leans against it.'],
    bpm: 84,
    timeSig: [4, 4],
    notes: groove({
      K: 'x..x.... | x..x.x.. | x..x.... | x..x.x..',
      S: '..X...X. | ..X...X. | ..X...X. | ..X...X.',
      H: 'xxxxxxxx | xxxxxxx. | xxxxxxxx | xxxxxxx.',
      O: '........ | .......x | ........ | .......x',
    }),
    hands: 'both',
    pass: { minAccuracy: 0.85, minTiming: 0.75 },
  },
  {
    id: 'bend-and-vibrato',
    stage: 7,
    kind: 'improvise',
    title: 'Make it sing: pitch bend and vibrato',
    goal: 'Improvise a synth melody in A minor pentatonic and shape notes with the pitch and mod strips.',
    intro: [
      'A piano note is fixed once you strike it – but a synthesizer can keep changing. The two touch strips next to the keys do exactly that: the pitch strip bends the note up or down, the mod strip adds vibrato.',
      'You know vibrato from the flute: a gentle wobble that makes a long note feel alive. Push the mod strip up a little on a long note, then bring it back down.',
      'For a bend, play a note and slide your finger up the pitch strip and back – like a singer sliding into a note. Every note of A minor pentatonic (A C D E G, purple dots) sounds good over the backing.',
    ],
    tips: ['Bend into the note on beat 1 of each bar.', 'Fewer notes, held longer, give the bends and vibrato room to sing.'],
    bpm: 72,
    timeSig: [4, 4],
    notes: pad(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']),
    hands: 'R',
    key: 'A minor',
    scale: [9, 0, 2, 4, 7],
    chords: barProg(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']),
    instrument: 'synth',
    pass: { minAccuracy: 0.8 },
    unlockAfter: 'pads-first-beat',
  },
]

export const STAGES: { stage: number; title: string; blurb: string }[] = [
  { stage: 1, title: 'Discover the keyboard', blurb: 'Middle C, finger numbers, both hands in C position, and your first tunes on white and black keys.' },
  { stage: 2, title: 'Rhythm & coordination', blurb: 'Hold long notes on a fading instrument, add the left hand, dotted rhythms, and your first jam.' },
  { stage: 3, title: 'Scales, intervals & patterns', blurb: 'Major and minor scales with thumb tucks, intervals by ear, and sequences composers love.' },
  { stage: 4, title: 'Chords & harmony', blurb: 'Triads, inversions, the four-chord loop, arpeggios, accompaniment patterns and why V7 goes home.' },
  { stage: 5, title: 'Playing real music', blurb: 'Beethoven, Mozart\'s favourite folk tune, a round, Greensleeves and a Baroque minuet, with phrasing and balance.' },
  { stage: 6, title: 'Improvisation & composition', blurb: 'Pentatonic, minor and blues improvising, question-and-answer phrases, and your first 8-bar composition.' },
  { stage: 7, title: 'Pads, bends & grooves', blurb: 'The MiniLab beyond the keys: drum grooves on the pads, a beat in one hand and chords in the other, and synth bends and vibrato on the touch strips. Opens after your first rhythm lesson.' },
]
