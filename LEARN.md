# Learn Section — Design Spec

A second section of the app: **Duolingo-style language lessons**, authored by *your own*
AI from source content and imported as files. Backendless and on-device, reusing the
router, Dexie storage, design system, reader gloss components, and file-import pattern.

Status: **design agreed, pre-implementation.** Organized as **vertical slices** — each
independently runnable and demoable end to end.

> The content pipeline (the whole point):
> ```
> source content  ─►  paste into your AI with the generator prompt (copied from the app
>                     for the course's languages, pre-filled with what the course already has)
>                 ─►  AI asks you clarifying questions, then returns unit(s) as JSON
>                 ─►  import the file  ─►  do the lessons (offline)
> ```

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| **Placement** | New **Learn** section beside **Read**, via a **top square `Read \| Learn` switcher** on a shared home. Settings/Saved remain icons. |
| **Backend** | **None.** Lessons authored by the user's AI, imported as files. Core Learn needs **no OpenAI key — fully offline**. |
| **First language** | **Farsi / Persian (`fa`)** — RTL, Perso-Arabic script. Reuses the reader's RTL support; needs a Persian-covering reading face (§2). |
| **Base language** | **Per-course, configurable** (`baseLang`). Start with English, but nothing hardcodes it — the app must support **learning L2 through another L2** later (e.g. base `de`, target `fr`). |
| **Exercise/screen types (MVP)** | **Teaching screens** (`teach`, no input — presents/explains) **+** four auto-graded types: **multiple-choice**, **tap-to-build word bank**, **match pairs**, **fill-in-the-blank**. |
| **Gloss** | **In from the start.** Tap a target word in any lesson → gloss, **reusing the reader's word-tokenization + popover components**. Source: the unit's `glossary` (offline) first, LLM fallback if a key is set. |
| **Hierarchy** | **Course → Unit → Lesson → Exercise.** Units are the "levels." |
| **Import granularity** | A file is a **course fragment**: course meta + **one or more units**. Merges into the course at **course / unit / lesson** granularity — so you can generate 2 units today, 2 more tomorrow, **and add lessons to existing units**. |
| **Game layer** | **Light** — no hearts/streak economy. **Rich animations** + **full stats**. |
| **Lesson flow** | **Instant check**; wrong answers show the correct one and **re-queue** until all correct. |
| **Progression** | Lessons unlock in order within a unit; a unit unlocks when the prior is complete. (Sequential, easily relaxed.) |
| **Stats tracked** | Progress (lessons/units done), accuracy (correct % + most-missed), XP, active days, time, volume. |
| **Grading** | Deterministic client-side for all graded types (no fuzzy/LLM grading in MVP). |

### Explicitly deferred → fast-follows (§6)
Typed-translation exercise (fuzzy/LLM grading) · listening via device TTS · speaking via
mic/speech-recognition · hearts/streaks/crowns · "most-missed items" targeted practice.

---

## 2. Architecture & reuse

No new infrastructure. Reuses:
- **Router** — new routes `learn`, `lesson`, `learn-stats`; the `Read | Learn` switcher on the shared home shell.
- **Dexie** — new `learn*` tables (§4), same DB.
- **Design system** — `Button`, `Rule`, `ProgressBar`, `Sheet`, cover/card styling, square + 3px-rule + serif-numeral vocabulary. A small animation layer (CSS keyframes) for feedback + celebration.
- **Reader gloss** — `SentenceText` tokenization + `SelectionPopover` render target words tappable inside exercises; `directionFor` + `readingFontStack` give RTL + script fonts.
- **Import pattern** — a learn-file parser mirroring the book parser registry: parse JSON → **validate** → merge-persist; malformed files rejected with a specific error.

**Persian font:** DM Serif Display and the current RTL faces (Frank Ruhl = Hebrew, Amiri = Arabic) — Amiri covers the Perso-Arabic script but not ideally. Add a Persian-first face (e.g. **Vazirmatn** for a clean modern look, or **Noto Naskh Arabic** for traditional) to the bundled woff2 set and route `fa` to it in `readingFontStack`. Also: language detection must distinguish `fa` from `ar` (Persian-specific letters پ چ ژ گ ک ی) — but Learn declares the language in the file, so detection matters only for the reader.

New domain code: `src/learn/`.

---

## 3. Import file schema (a course fragment)

A `.json` file. `breaderLearn` is the schema version.

```jsonc
{
  "breaderLearn": 1,
  "course": {
    "id": "fa-foundations",     // stable; fragments sharing this id merge into one course
    "title": "Persian — Foundations",
    "targetLang": "fa",         // BCP-47
    "baseLang": "en"            // configurable per course
  },
  "units": [                    // ONE OR MORE units per file
    {
      "id": "fa-foundations-u1",
      "index": 1,               // order within the course
      "title": "Alphabet & Sounds",
      "glossary": [             // optional: offline gloss source for words used in this unit
        { "word": "سلام", "gloss": "hello", "note": "informal greeting" }
      ],
      "lessons": [
        { "id": "fa-foundations-u1-l1", "index": 1, "title": "First letters",
          "exercises": [ /* §3.1 */ ] }
      ]
    }
  ]
}
```

**Merge semantics on import:** upsert the course by `course.id`; for each unit, upsert by
`unit.id` (updates title/index/glossary); for each lesson, **upsert by `lesson.id`** —
so new lessons append to an existing unit and an edited lesson replaces itself. Merge only
adds/updates (never deletes). The original file is retained for reprocessing.

### 3.1 Screen & exercise types (discriminated by `type`)

Common optional fields: `note` (teaching tip shown after answering), `translation`
(base-language gloss of a target sentence, for context).

```jsonc
// 0. teaching screen — NO input; presents/explains, then Continue
{ "type": "teach",
  "title": "Persian has no grammatical gender",
  "body": "Nouns aren't masculine or feminine. Verbs don't change for gender either.",
  "examples": [["او رفت", "he went / she went"]] }   // optional target/base pairs

// 1. multiple choice
{ "type": "choice",
  "prompt": "How do you say “hello”?",
  "choices": ["سلام", "خداحافظ", "بله", "نه"],
  "answer": 0 }

// 2. tap-to-build word bank
{ "type": "build",
  "prompt": "Translate: I am a student.",
  "tiles": ["من", "دانشجو", "هستم", "او", "معلم"],
  "answer": ["من", "دانشجو", "هستم"],
  "accept": [["من", "دانشجو", "هستم"]] }             // optional alt orders

// 3. match pairs
{ "type": "match",
  "pairs": [["سلام", "hello"], ["ممنون", "thank you"], ["بله", "yes"]] }

// 4. fill in the blank
{ "type": "blank",
  "prompt": "من ___ هستم.",
  "translation": "I am a student.",
  "choices": ["دانشجو", "معلم", "دکتر"],
  "answer": 0 }
```

### 3.2 Grading (deterministic, client-side)
- **choice / blank:** `selectedIndex === answer`.
- **build:** built sequence equals `answer`, or ∈ `accept`.
- **match:** every pair matched; wrong taps counted as mistakes.
- **teach:** no grading — Continue advances.
- Wrong answers **re-queue** to the end; the lesson completes when the queue is empty.

---

## 4. On-device model (IndexedDB via Dexie)

```ts
interface LearnCourse { id; title; targetLang; baseLang; dir: 'ltr'|'rtl'; createdAt }
interface LearnUnit   { id; courseId; index; title; glossary?: {word;gloss;note?}[] }
interface LearnLesson { id; unitId; courseId; index; title; items: LessonItem[] } // teach+exercises
interface LearnProgress { lessonId; courseId; unitId; completed; bestAccuracy; attempts; lastAt }
interface LearnStats  { id:'singleton'; xp; totalExercises; totalCorrect; totalTimeMs; activeDays: string[] }
```
`items` holds the ordered `teach`/`choice`/`build`/`match`/`blank` objects. Glossary lives
on the unit for offline gloss lookup.

---

## 5. Vertical slices

Each slice is browser-verified (both themes, LTR + the Persian RTL case) before moving on.

### L0 — App shell: two sections
Top `Read | Learn` switcher on the shared home; Learn empty state; `learn` route; `learn*`
Dexie tables. Reader unchanged.
**Done when:** flip between Read and Learn; Learn shows its empty state in both themes.

### L1 — Import a course fragment + the path
Learn-file parser: parse → validate (clear errors) → **merge-persist** (course/unit/lesson
upsert). Learn home renders the **course → unit → lesson path** (units as levels, lesson
bubbles, sequential-unlock lock state), reusing card/rule/numeral styling. Persian renders
RTL in its script font.
**Done when:** import a generated fragment and see the path; a second fragment for the same
course appends units *and* adds lessons to an existing unit; a malformed file is rejected clearly.

### L2 — Lesson player (with gloss)
The teaching screen + four exercise UIs, square/on-brand, RTL-aware. Instant check +
re-queue; per-lesson progress bar. **Tap-a-word gloss** via the reader's popover (glossary
first, LLM fallback). Feedback animations (correct/wrong) + **lesson-complete celebration**.
**Done when:** play a full Persian lesson offline — teaching screens explain, exercises
grade, mistakes re-queue, tapping a word glosses it, finishing celebrates.

### L3 — Progression + stats
Unlock next lesson/unit; XP on completion; `LearnProgress` + `LearnStats` (accuracy, active
days, time, volume). **Stats screen.** Course/unit management: delete, **reset progress**.
**Done when:** completing lessons unlocks the next and updates the stats screen; delete a
course or reset its progress.

### L4 — In-app generator-prompt helper (context-aware)
Per-course "Add lessons" / global "New course" screen that shows the **copyable generator
prompt** for that course's `targetLang`/`baseLang`, **pre-filled with the course's current
structure** (existing units + lesson counts + next indices) so the AI continues coherently
and may extend existing units or add new ones. Plus the import entry point and short docs.
**Done when:** from inside a course you copy a prompt that already knows what the course
contains, generate in your AI, and import the result.

---

## 6. Fast-follows (post-MVP, pre-scoped)
- **F-typed** — free-type translation exercise (fuzzy match, optional key-graded).
- **F-listen** — listening via device `SpeechSynthesis`; a "listen" button on other types.
- **F-speak** — speaking via mic + `SpeechRecognition`.
- **F-game** — hearts/lives, daily streak, crown/mastery levels.
- **F-missed** — "most-missed items" analytics + targeted practice.

---

## 7. The generator prompt (the copyable artifact)

Shipped in L4, copied from the app for a specific course. Structure:

> You are authoring language-learning content for the "Learn" section of an app. When you
> are ready, output **only** valid JSON matching this schema *(schema from §3 inline)* —
> but **not yet**.
>
> - Target language: **{TARGET}**. Base language: **{BASE}**.
> - Course context: **{one of —}**
>   - *New course.* / *This course already contains: Unit 1 "…" (4 lessons), Unit 2 "…"
>     (3 lessons). Next unit index is 3; you may add new units and/or add lessons to
>     existing units.*
> - Source material: `{PASTE YOUR SOURCE CONTENT HERE}`
>
> **First, before generating anything, ask me clarifying questions** to confirm how to
> structure this — how much of the material warrants a unit vs a lesson, the level, the
> scope, whether to extend existing units or add new ones, ordering, and anything ambiguous.
> **Decide the number of units and lessons yourself** from the amount and nature of the
> content — do not use a fixed count. Only after I confirm, output the JSON (course meta +
> the new/updated units). Requirements: stable unique ids and correct indices; a unit
> `glossary` covering the vocabulary used; **teaching (`teach`) screens** to introduce new
> concepts before drilling them; plausible near-miss distractors; short, level-appropriate
> sentences; natural base-language translations.

---

## 8. Open assumptions
- Base language is per-course, defaulting to **English** for now; no code hardcodes `en`.
- First course language is **Persian (`fa`)**; RTL + a bundled Persian face.
- Lessons play in **authored order**; the AI is asked to order pedagogically.
- Sequential unlock (unit N needs unit N-1); trivially relaxed to free-play.
- Core Learn is **offline & keyless**; gloss uses the file glossary offline, LLM only if a
  key is present. Only fast-follows (typed grading, TTS/mic) add network/device APIs.
