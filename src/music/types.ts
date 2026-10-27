// Integration contract shared by lessons, engine, renderer, recorder and persistence.
// All musical time is in BEATS (quarter notes). Seconds only exist inside the transport.

export type Hand = 'L' | 'R'

export interface NoteEvent {
  pitch: number // MIDI note number, 60 = middle C (C4); drum hits use PAD_PITCH + drum index (see drums.ts)
  start: number // onset in beats from the start of the piece
  dur: number // duration in beats
  hand: Hand
  vel?: number // 1..127, default 80
  finger?: number // 1 = thumb .. 5 = little finger
  drum?: number // 0–7: a pad/drum hit (Kick, Snare, Closed hat, Open hat, Clap, Low tom, High tom, Crash)
}

export type PracticeMode = 'watch' | 'wait' | 'rhythm' | 'free' | 'loop'

/**
 * play      – falling-note piece, scored against `notes`
 * improvise – app plays `notes` (backing, hand 'L'); user plays freely, scored on staying in `scale`
 * echo      – ear training: app plays each phrase in `phrases`, user plays it back by ear
 */
export type LessonKind = 'play' | 'improvise' | 'echo'

export interface Lesson {
  id: string // kebab-case, unique
  stage: 1 | 2 | 3 | 4 | 5 | 6 | 7
  kind: LessonKind
  title: string
  goal: string // one-sentence learning objective
  intro: string[] // 1–4 short paragraphs shown before playing; contextual theory, no lectures
  tips?: string[] // shown during practice
  bpm: number
  timeSig: [number, number]
  notes: NoteEvent[] // for 'echo' lessons may be empty
  phrases?: number[][] // echo only: each phrase is a list of MIDI pitches played one per beat
  hands: 'R' | 'L' | 'both' // which hand(s) the user plays; other notes are auto-played
  key?: string // e.g. 'C major', 'A minor' – drives the theory panel
  scale?: number[] // pitch classes 0–11 allowed in improvise lessons / highlighted on keys
  chords?: { beat: number; name: string }[] // optional chord symbols shown above the notes
  countIn?: number // beats of count-in, default one bar
  pass: {
    minAccuracy: number // 0..1 fraction of expected notes hit (pitch) for a star
    minTiming?: number // 0..1 fraction of hits that are on time (rhythm mode)
  }
  /** Sound for the lesson (e.g. 'synth' for pitch-bend lessons); default is the user's instrument. */
  instrument?: 'piano' | 'epiano' | 'strings' | 'synth' | 'harmonium'
  /** Unlock after this lesson has a star, instead of after the previous piece (side tracks like the pads stage). */
  unlockAfter?: string
  /** Shown when the piece needs the MiniLab octave buttons. Default range is C3–C5 (48–72). */
  octaveHint?: string
}
