# breader — Learn Section Design Spec

A second section of the breader PWA: **Duolingo-style language lessons**, generated
by *your own* AI from source content and imported as files. Everything stays
backendless and on-device, reusing breader's router, Dexie storage, design system,
and file-import pattern.

Status: **design agreed, pre-implementation.** Organized as **vertical slices** — each
independently runnable and demoable end to end.

The content pipeline (the whole point):

```
source content  ──►  paste into your AI (ChatGPT/Claude) with the generator prompt
                     ──►  AI returns a unit as JSON  ──►  import the file into breader
                     ──►  do the lessons (fully offline)
```

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| **Placement** | New **Learn** section beside **Read**, reached via a **top square `Read \| Learn` switcher** on a shared home. Settings/Saved remain icons. |
| **Backend** | **None.** Lessons are authored by the user's own AI and imported as files. Core Learn needs **no OpenAI key — fully offline** (the file carries both languages, distractors, and answers). |
| **Exercise types (MVP)** | Four auto-graded, offline, text-only: **multiple-choice**, **tap-to-build word bank**, **match pairs**, **fill-in-the-blank**. |
| **Hierarchy** | **Course → Unit → Lesson → Exercise.** Units are the "levels." |
| **Import granularity** | **One file = one unit**, declaring its course. Units with the same `course.id` **merge** → build a course up unit-by-unit (sidesteps AI output limits). |
| **Game layer** | **Light** — no hearts/streak economy. **Rich animations** (per-answer feedback, progress fill, lesson-complete celebration) + **full stats**. |
| **Lesson flow** | **Instant check**; a wrong answer shows the correct one and is **re-queued** later in the lesson until everything is answered correctly. |
| **Progression** | Lessons unlock in order within a unit; a unit unlocks when the prior unit is complete. (Sequential, easily relaxed.) |
| **Stats tracked** | Progress (lessons/units done), accuracy (correct % + most-missed), XP, active days, time, volume. |
| **Grading** | Deterministic client-side for all four types (no fuzzy/LLM grading in MVP). |
| **Languages** | Each course declares `targetLang` + `baseLang` (default base English). **RTL-aware** — target text uses `dir`/script fonts from the reader's existing config. |

### Explicitly deferred → fast-follows (§6)
Typed-translation exercise (fuzzy/LLM grading) · listening via device TTS · speaking via
mic/speech-recognition · hearts/streaks/crowns · tap-a-word-for-gloss inside a lesson ·
pronunciation audio (TTS) · "most-missed items" analytics refinement.

---

## 2. Architecture & reuse

Learn adds no new infrastructure. It reuses:
- **Router** (`src/router.ts`) — new routes `learn`, `lesson`, `learn-stats`; the top
  section switcher lives in the shared home shell.
- **Dexie** (`src/db/schema.ts`) — new `learn*` tables (below), same DB.
- **Design system** — `Button`, `Rule`, `ProgressBar`, `Sheet`, cover-style cards, the
  3px-rule / serif-numeral / square vocabulary. Lesson feedback adds a small animation
  layer (CSS keyframes, in-language-system easing).
- **Import pattern** — a new **learn-file parser** mirroring the book parser registry:
  parse JSON → validate against the schema → persist. Malformed files are rejected with
  a clear, specific error (AI output isn't always clean).
- **RTL** — `directionFor(lang)` + `readingFontStack(lang, …)` already exist; target
  text in exercises renders with them.

New domain code lives under `src/learn/`.

---

## 3. Import file schema (one unit)

A `.json` file. `breaderLearn` is the schema version.

```jsonc
{
  "breaderLearn": 1,
  "course": {
    "id": "de-travel",          // stable; units sharing this id merge into one course
    "title": "German — Travel",
    "targetLang": "de",         // BCP-47
    "baseLang": "en"
  },
  "unit": {
    "id": "de-travel-u1",       // stable; re-import replaces this unit's content
    "index": 1,                 // order within the course
    "title": "At the Airport",
    "lessons": [
      {
        "id": "de-travel-u1-l1",
        "title": "Check-in",
        "exercises": [ /* see §3.1 */ ]
      }
    ]
  }
}
```

### 3.1 Exercise types (discriminated by `type`)

Common optional fields on every exercise: `note` (a teaching tip shown after answering),
`translation` (base-language gloss of the target sentence, for context).

```jsonc
// 1. multiple choice — pick the correct option
{ "type": "choice",
  "prompt": "How do you say “the passport”?",
  "choices": ["der Reisepass", "der Koffer", "das Ticket", "der Flughafen"],
  "answer": 0 }                                   // index into choices

// 2. tap-to-build word bank — tap tiles to build the sentence
{ "type": "build",
  "prompt": "Translate: I have a ticket.",
  "tiles": ["Ich", "habe", "ein", "Ticket", "du", "Koffer"],   // incl. distractor tiles
  "answer": ["Ich", "habe", "ein", "Ticket"],     // correct ordered sequence
  "accept": [["Ich", "habe", "ein", "Ticket"]] }  // optional: extra valid orders

// 3. match pairs — tap a target tile then its base translation
{ "type": "match",
  "pairs": [["der Hund", "the dog"], ["die Katze", "the cat"], ["das Haus", "the house"]] }

// 4. fill in the blank — choose the word that fills the gap
{ "type": "blank",
  "prompt": "Ich ___ nach Berlin.",
  "translation": "I am going to Berlin.",
  "choices": ["fahre", "fährt", "fahren"],
  "answer": 0 }
```

### 3.2 Grading (deterministic, client-side)
- **choice / blank:** `selectedIndex === answer`.
- **build:** the built token sequence equals `answer`, or is a member of `accept`.
- **match:** every pair correctly matched; wrong taps count as mistakes.
- A wrong answer is **re-queued** to the end of the lesson; the lesson completes when the
  queue is empty (everything answered correctly at least once).

---

## 4. On-device model (IndexedDB via Dexie)

```ts
interface LearnCourse {
  id: string            // from file course.id
  title: string
  targetLang: string
  baseLang: string
  dir: 'ltr' | 'rtl'
  createdAt: number
}

interface LearnUnit {
  id: string            // from file unit.id
  courseId: string
  index: number
  title: string
}

interface LearnLesson {
  id: string
  unitId: string
  courseId: string
  index: number
  title: string
  exercises: Exercise[] // nested — a lesson is the play unit
}

interface LearnProgress {           // one row per lesson attempted
  lessonId: string
  courseId: string
  unitId: string
  completed: boolean
  bestAccuracy: number              // 0–1
  attempts: number
  lastAt: number
}

interface LearnStats {              // singleton aggregate
  id: 'singleton'
  xp: number
  totalExercises: number
  totalCorrect: number
  totalTimeMs: number
  activeDays: string[]              // 'YYYY-MM-DD'
}
// (most-missed analytics: optional LearnMiss tally — fast-follow)
```
The **original unit file** is retained (like book blobs) so a unit can be re-processed by
a future schema version.

---

## 5. Vertical slices

Each slice is independently runnable and browser-verified (both themes) before moving on.

### L0 — App shell: two sections
**Goal:** Read and Learn coexist.
- Top `Read | Learn` segmented switcher on the shared home; Learn home is an empty state.
- Router routes for `learn`; Dexie `learn*` tables created (empty).
- Learn home: "no courses yet — import a unit to start."

**Done when:** you can flip between Read and Learn; the reader is unchanged; Learn shows its empty state in both themes.

### L1 — Import a unit
**Goal:** get real content in and see the path.
- Learn-file parser: parse JSON → **validate** against the schema (clear errors on bad
  files) → persist course/unit/lessons (merge by `course.id`, replace by `unit.id`).
- Learn home renders the **course → unit → lesson path** (units as levels, lesson
  bubbles), reusing card/rule/numeral styling. Lock state shown (sequential unlock).

**Done when:** import a generated unit file and see its course, units, and lessons laid out; a second unit for the same course appends; a malformed file is rejected with a useful message.

### L2 — Lesson player
**Goal:** the core Duolingo loop.
- The four exercise UIs (choice, build, match, blank), square/on-brand.
- Instant check + re-queue-wrong; per-lesson progress bar.
- Feedback animations: correct (green + check), wrong (shake + correct answer), and a
  **lesson-complete celebration**. Tile/press micro-interactions.

**Done when:** play a full lesson end to end — mistakes re-queue, the bar advances, and finishing shows the celebration. Works offline with no API key.

### L3 — Progression + stats
**Goal:** make it stick and measurable.
- Unlock logic (next lesson/unit), XP award on completion, `LearnProgress` + `LearnStats`
  updates (accuracy, active days, time, volume).
- **Stats screen** (progress, accuracy, XP, active days, time/volume).
- Course/unit management: delete, **reset progress** (reuse the ⋯-menu pattern).

**Done when:** completing lessons unlocks the next and updates a stats screen; you can delete a course or reset its progress.

### L4 — "New lesson" helper
**Goal:** close the authoring loop in-app.
- A screen that shows the **copyable generator prompt** (with fields for target language,
  theme/level) and the import entry point, plus short docs on the paste-to-AI workflow.

**Done when:** from inside the app you can copy the prompt, generate a unit in your AI, and import it — without leaving to find instructions.

---

## 6. Fast-follows (post-MVP, pre-scoped)

- **F-typed** — free-type translation exercise (fuzzy match, optional OpenAI-key grading).
- **F-listen** — listening exercises via the device Web Speech `SpeechSynthesis` (free,
  no audio files); a "listen" button on other types.
- **F-speak** — speaking exercises via mic + `SpeechRecognition` (browser-dependent).
- **F-game** — hearts/lives, daily streak, crown/mastery levels.
- **F-gloss** — tap a word during a lesson for its meaning (reuse the reader popover;
  needs the key or file-supplied glosses).
- **F-missed** — "most-missed items" analytics + targeted practice sessions.

---

## 7. The generator prompt (the copyable artifact)

Shipped in L4; the user fills the three braces and pastes their source content.

> You are authoring a language-learning **unit** for an app. Output **only** valid JSON,
> nothing else, matching exactly this schema: *(schema from §3 inline)*.
>
> - Target language: **{TARGET, e.g. German (de)}**. Base language: **{BASE, e.g. English (en)}**.
> - Theme / level: **{THEME+LEVEL, e.g. "At the airport", A1}**.
> - Produce **one unit** with **3–4 lessons** of **6–8 exercises** each, mixing all four
>   types (`choice`, `build`, `match`, `blank`).
> - Wrong choices must be **plausible near-misses**; sentences short and level-appropriate;
>   include natural base-language translations; give each lesson a clear title.
> - Use stable, unique `id`s (`{course}-u{n}`, `{course}-u{n}-l{m}`). Set `unit.index`.
> - Base vocabulary and phrasing on this source material:
>
> ```
> {PASTE YOUR SOURCE CONTENT HERE}
> ```

---

## 8. Open assumptions

- Base language defaults to **English**, consistent with the reader.
- Lessons play in **authored order**; the AI is asked to order them pedagogically.
- Sequential unlock (unit N needs unit N-1 complete); trivially relaxed to free-play.
- Core Learn is **offline & keyless**; only fast-follows (typed grading, TTS/mic) touch
  the network or device APIs.
- The unit file is the durable source; re-importing a `unit.id` replaces that unit's
  content but preserves the course and other units.
