# Keyfall

Learn piano and make music with an Arturia MiniLab 3 (or any MIDI keyboard): Synthesia-style falling notes, a 30-lesson
curriculum written for 25 keys, teacher-style feedback, a live theory panel, and a small studio to record, edit and
export your own ideas. Runs in Chrome or Edge, offline, no accounts.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 in **Chrome or Edge** (Web MIDI is not available in Firefox/Safari by default), plug in the
MiniLab, and follow the setup. No keyboard handy? The computer keys work too: `A S D F G H J K L ;` are white keys,
`W E T Y U O P` black keys, `Z`/`X` shift octave, `1`–`8` are the drum pads.

For a faster local build: `npm run build` then `npm run preview` (MIDI needs `localhost` or https – opening
`dist/index.html` from disk will not work).

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

The end-to-end tests use the Microsoft Edge installed with Windows.

## Docs

- `docs/PRODUCT_SPEC.md` – what the app is and its rules
- `docs/ARCHITECTURE.md` – modules, the single clock, MIDI→audio time mapping, scoring
- `docs/CURRICULUM.md` – the teacher's notes behind the lessons
- `docs/ROADMAP.md`, `docs/TASKS.md` – milestones, test status and the manual hardware checklist

Piano samples: Salamander Grand Piano (CC-BY 3.0, Alexander Holm), via the Tone.js sample set, stored in
`public/samples/piano`.
