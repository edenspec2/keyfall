/** Mochi, the Mochi MIDI mascot: a soft mochi with a music-note sprout. Moods follow how a run went. */
export type Mood = 'happy' | 'star' | 'calm'

export function Mascot({ size = 40, mood = 'happy', title }: { size?: number; mood?: Mood; title?: string }) {
  const id = `mochi-${mood}`
  return (
    <svg className={`mascot mascot-${mood}`} width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.65" stopColor="#ffe3ef" />
          <stop offset="1" stopColor="#ffc2dc" />
        </radialGradient>
      </defs>
      {/* music-note sprout */}
      <path d="M33 14 C33 8 37 5 42 4 L42 9 C38 10 36 11 36 15" fill="#c9a7ff" />
      <circle cx="31.5" cy="15.5" r="3.4" fill="#c9a7ff" />
      {/* body */}
      <path d="M6 44 C6 26 18 16 32 16 C46 16 58 26 58 44 C58 54 48 58 32 58 C16 58 6 54 6 44 Z" fill={`url(#${id}-body)`} stroke="#f2a7c8" strokeWidth="2" />
      <ellipse cx="20" cy="31" rx="5" ry="3" fill="#ffffff" opacity="0.8" />
      {/* cheeks */}
      <ellipse cx="16" cy="45" rx="5" ry="3.2" fill="#ff9cc6" opacity="0.7" />
      <ellipse cx="48" cy="45" rx="5" ry="3.2" fill="#ff9cc6" opacity="0.7" />
      {/* eyes */}
      {mood === 'star' ? (
        <>
          <path d="M23 34 l1.6 3.4 3.6.4-2.7 2.5.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.5 3.6-.4z" fill="#ffb703" />
          <path d="M41 34 l1.6 3.4 3.6.4-2.7 2.5.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.5 3.6-.4z" fill="#ffb703" />
        </>
      ) : mood === 'calm' ? (
        <>
          <path d="M19 40 q4 -4 8 0" stroke="#4a2c47" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M37 40 q4 -4 8 0" stroke="#4a2c47" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="23" cy="39" rx="3" ry="3.6" fill="#4a2c47" />
          <ellipse cx="41" cy="39" rx="3" ry="3.6" fill="#4a2c47" />
          <circle cx="24.1" cy="37.6" r="1.1" fill="#ffffff" />
          <circle cx="42.1" cy="37.6" r="1.1" fill="#ffffff" />
        </>
      )}
      {/* mouth */}
      {mood === 'star'
        ? <path d="M27 46 q5 6 10 0 z" fill="#e8508f" />
        : <path d="M28.5 46 q3.5 3 7 0" stroke="#4a2c47" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
    </svg>
  )
}
