# breader — Design Spec

A bilingual reader PWA for learning languages. Bring an ebook, read it one sentence
at a time (portrait) or as an aligned target/base pair (landscape), and tap words or
phrases for on-demand translation. Everything is stored on-device; translation uses
the reader's own OpenAI key.

Status: **design agreed, pre-implementation.** This document is the durable reference.
It is organized so the build proceeds as a series of **vertical slices** — each slice
is independently runnable and adds a complete, demoable piece of functionality end to
end, rather than building horizontal layers that only pay off later.

---

## 1. Locked decisions

These were resolved during design and are treated as settled for MVP.

| Area | Decision |
|---|---|
| **App type** | Installable **PWA**, offline-capable via service worker. |
| **Primary target** | **iOS Safari first** (request persistent storage to resist eviction); Android/Chrome as a bonus. |
| **Backend** | **None.** No auth, no server, no database. Static hosting only. |
| **Storage** | **Everything on-device**: books, sentence lists, translations, settings, OpenAI key (IndexedDB). |
| **Stack** | **React + Vite + TypeScript**, Dexie (IndexedDB), `vite-plugin-pwa`, `Intl.Segmenter`. |
| **Formats (MVP)** | **.epub + .txt.** PDF is a planned fast-follow → import built behind a pluggable parser interface. |
| **Languages (MVP)** | Base **English**; targets **German + French**. Hebrew + Arabic are a fast-follow → reader is **RTL-aware from day one**. |
| **Language detection** | **Auto-detect** (EPUB metadata + text sample), **confirm/override at import**. |
| **Parsing** | **Full parse + sentence-segmentation at import**, persisted. Flatten to sentences, **keep chapters + ToC**. Data model is structure-rich so paragraphs/formatting/images can be added without a rewrite. |
| **Portrait mode** | One large sentence at a time; navigate by **vertical and horizontal swipe**. |
| **Landscape mode** | One aligned **target/base sentence pair** at a time. **Shared reading position** with portrait — rotating keeps your place. |
| **Word lookup (MVP)** | **LLM-only** (word + sentence context) → gloss in a **popover** near the word. Offline dictionary is post-MVP. |
| **Phrase lookup** | **Tap a word, then tap a second word** → the span between them is translated as a phrase. Tap empty space clears. |
| **Sentence translation** | **Lazy on first read + look-ahead prefetch**, **batched ~5–10 sentences per call** (structured JSON), each cached individually and permanently. |
| **Model** | **Cheap model by default** (e.g. `gpt-4o-mini`-class), **user-configurable** in Settings. |
| **Failure behavior** | **Graceful degradation.** Cached content always readable offline; live failures show non-blocking inline states with retry; backoff on rate limits. Reading is never hard-blocked. |
| **Appearance (MVP)** | Font size, light/dark (system + toggle), font family (script-aware config). |

### Explicitly deferred (post-MVP)
PDF import · Hebrew/Arabic · offline dictionary (hybrid dictionary-first lookup) ·
paragraph/formatting/image rendering · iOS share-sheet import · line-spacing/margin
controls · accounts / cross-device sync.

---

## 2. Architecture

### 2.1 Shape
A single static bundle. No network dependency except direct browser → OpenAI calls
for translation (with the user's key). The service worker caches the app shell for
offline use; all user data lives in IndexedDB.

```
┌────────────────────────────────────────────────────────────┐
│  PWA (static, installed to home screen)                     │
│                                                             │
│  UI (React)                                                 │
│   ├─ Library        ├─ Reader (portrait / landscape)        │
│   └─ Settings       └─ Word/phrase popover                  │
│                                                             │
│  Domain                                                     │
│   ├─ parsing/    SourceFile → ParsedDoc → Sentence[]        │
│   ├─ lang/       detect + direction (ltr/rtl)               │
│   └─ translation/ batching, prefetch, cache lookup          │
│                                                             │
│  Persistence (Dexie / IndexedDB)                            │
│   books · sentences · translations · settings              │
└──────────────────────────────┬─────────────────────────────┘
                               │ fetch (user's key)
                               ▼
                         OpenAI API
```

### 2.2 Key principles
- **On-device is the source of truth.** Nothing is uploaded anywhere except the text
  being translated, sent to OpenAI.
- **Pluggable parsing.** Every format implements one interface so PDF slots in later.
- **Structure-rich model, thin renderer.** The stored model carries chapter/paragraph
  refs (and room for formatting/images) even though the MVP renderer shows plain text.
- **Position is a single index** shared across reading modes and persisted per book.
- **Translation cache is content-addressed** so re-reads and mode switches never re-pay.
- **Direction-aware layout** so RTL languages are a data change, not a refactor.

---

## 3. Data model (IndexedDB via Dexie)

Concrete enough to build against; field names may be refined in Slice 1.

```ts
// A book on the shelf.
interface Book {
  id: string;                 // uuid
  title: string;
  author?: string;
  format: 'txt' | 'epub';     // 'pdf' later
  targetLang: string;         // BCP-47, e.g. 'de', 'fr'
  baseLang: 'en';             // fixed for MVP
  dir: 'ltr' | 'rtl';         // derived from targetLang
  sentenceCount: number;
  positionIndex: number;      // resume point (global sentence index)
  createdAt: number;
  coverBlobId?: string;       // future
}

// One sentence of the target text. The atomic unit of reading + translation.
interface Sentence {
  id: string;                 // `${bookId}:${index}`
  bookId: string;
  index: number;              // global order within the book
  chapterIndex: number;       // for ToC / navigation
  paragraphIndex: number;     // reserved for paragraph-preserving fast-follow
  text: string;               // plain target text
  // reserved (post-MVP): spans?: FormatSpan[]; images?: ImageRef[];
}

interface Chapter {
  bookId: string;
  index: number;
  title: string;
  startSentenceIndex: number;
}

// Cached translation, content-addressed so it survives edits/reimports of unrelated text.
interface Translation {
  key: string;                // hash(kind + targetLang + baseLang + model + sourceText [+ context])
  kind: 'sentence' | 'word' | 'phrase';
  sourceText: string;
  result: string;             // base-language translation / gloss
  context?: string;           // sentence context for word/phrase lookups
  model: string;
  createdAt: number;
}

interface Settings {
  id: 'singleton';
  openaiKey?: string;         // stored on-device only
  model: string;              // default cheap model, editable
  theme: 'system' | 'light' | 'dark';
  fontScale: number;          // e.g. 1.0
  fontFamily: string;
}
```

Notes:
- **Raw imported file** (the original .epub/.txt Blob) is also stored, so a book can be
  re-processed by a future parser version without re-importing.
- Translation `key` includes `model` so switching models doesn't return stale glosses;
  old entries remain cached and reusable if you switch back.

---

## 4. Project scaffold (for review)

Proposed directory layout. **Nothing is created yet** — this is here for you to approve
before we scaffold.

```
breader/
  index.html
  package.json
  tsconfig.json
  vite.config.ts                 # + vite-plugin-pwa config
  public/
    manifest.webmanifest
    icons/                       # PWA icons
  src/
    main.tsx
    App.tsx                      # routing + theme provider
    routes/
      Library.tsx
      Reader.tsx
      Settings.tsx

    parsing/                     # ── pluggable import pipeline ──
      types.ts                   # SourceFile, ParsedDoc, Sentence, Chapter
      registry.ts                # picks parser by file type
      txtParser.ts
      epubParser.ts              # (Slice 4)
      segmenter.ts               # Intl.Segmenter sentence/word splitting
      # pdfParser.ts             # (post-MVP, drops in here)

    lang/
      detect.ts                  # metadata + sample-based detection
      direction.ts               # lang → 'ltr' | 'rtl'

    translation/                 # ── OpenAI-backed, cached ──
      openaiClient.ts            # thin fetch wrapper, model-agnostic
      sentenceTranslator.ts      # windowed batching + prefetch
      wordTranslator.ts          # word/phrase in-context lookup
      cache.ts                   # content-addressed get/put
      types.ts

    db/                          # ── Dexie schema + repositories ──
      schema.ts
      books.ts
      sentences.ts
      translations.ts
      settings.ts

    reader/                      # ── reading UI ──
      usePosition.ts             # shared position, persisted
      useGestures.ts             # swipe (both axes)
      PortraitView.tsx           # one big sentence
      LandscapeView.tsx          # aligned pair
      SelectionPopover.tsx       # word/phrase gloss
      useWordSelection.ts        # tap → word / second tap → range

    ui/
      components/                # shared primitives
      theme/                     # tokens, light/dark, font config

    state/                       # app-level state (settings, current book)
```

Design intent visible in the layout:
- `parsing/` is the seam for PDF. `translation/` never imports UI. `reader/` never
  talks to OpenAI directly — it goes through `translation/`.
- `lang/direction.ts` is the single place RTL is decided.

---

## 5. Vertical slices (build roadmap)

Each slice is **end-to-end and demoable**. Ordering front-loads the riskiest core
experience (reading + tap-to-translate on plain text) and defers the heaviest parsing
(EPUB) until the reading loop is proven. A slice is "done" only when its acceptance
checks pass on an actual iPhone.

### Slice 0 — Walking skeleton
**Goal:** an installable PWA that boots.
- Vite + React + TS project; `vite-plugin-pwa` manifest + service worker.
- Empty Library / Reader / Settings routes; theme provider with light/dark.
- Dexie initialized with the schema above (empty).
- Request persistent storage on first load.

**Done when:** installs to iOS home screen, launches offline to an empty Library,
light/dark follows the system.

### Slice 1 — Read a plain-text book (portrait, no translation)
**Goal:** the core reading loop, proven on the simplest format.
- Import a `.txt` via the file picker; store the Blob.
- `segmenter.ts` splits into `Sentence[]`; persist book + sentences.
- Library shows the book with progress; tap to open.
- **PortraitView**: one large sentence; **vertical + horizontal swipe** to move.
- Position persists; reopening resumes.
- Font-size control (minimum viable appearance).

**Done when:** import a German `.txt`, read it sentence-by-sentence, close and reopen
to the same spot.

### Slice 2 — Tap a word → translation (first OpenAI integration)
**Goal:** the signature interaction, on top of the working reader.
- Settings: enter + store OpenAI key; choose model (defaulted).
- First-run nudge if no key is set.
- `wordTranslator.ts`: tap a word → send word + sentence → **SelectionPopover** gloss.
- Cache results (content-addressed); repeat taps are instant/offline.
- Graceful failure states in the popover (offline / no key / retry).

**Done when:** tapping any word shows a contextual translation, cached and offline on
the second tap; missing key and offline both degrade gracefully.

### Slice 3 — Landscape aligned pair + lazy sentence translation
**Goal:** the second reading mode and the batched translation engine.
- `sentenceTranslator.ts`: translate current + next N in one batched call, cache each.
- **LandscapeView**: target/base pair for the current sentence; prefetch look-ahead.
- **Shared position** — rotating between portrait/landscape keeps the same sentence.
- Direction-aware layout wired through (`lang/direction.ts`), even if MVP langs are LTR.

**Done when:** rotate to landscape mid-read and see the aligned translation of the
current sentence appear (prefetched), with the same position on rotating back.

### Slice 4 — EPUB import (real books)
**Goal:** ingest actual ebooks with structure.
- `epubParser.ts`: unzip, extract text in spine order, **keep chapters + build ToC**.
- `lang/detect.ts`: auto-detect + **confirm/override dialog** at import.
- Populate `Chapter[]`; add chapter jump / ToC to the reader.
- Everything from Slices 1–3 now works on EPUB unchanged (validates the parser seam).

**Done when:** import a real German/French EPUB, navigate by chapter, read + translate
exactly as with `.txt`.

### Slice 5 — Phrase selection + depth
**Goal:** complete the tap interaction and lookup depth.
- `useWordSelection.ts`: tap a second word → select the span → **phrase** translation.
- "Explain more" action in the popover (richer LLM call).
- Appearance: font family choice; finalize graceful-degradation polish + retry/backoff.

**Done when:** select a multi-word phrase and get a single coherent translation; word
popover offers a deeper explanation.

### Slice 6 — Library management + resilience
**Goal:** make it a keepable multi-book app.
- Multi-book shelf polish: per-book **delete** and **clear cached translations**.
- Storage-usage visibility; confirm persistent-storage grant.
- Resume/position hardening across large books.

**Done when:** manage several books, delete one, clear a book's translation cache, and
storage stays within a sane budget.

---

## 6. Fast-follow slices (post-MVP, pre-scoped)

Sequenced but not part of MVP. Each is still a vertical slice.

- **F1 — PDF import.** New `pdfParser.ts` behind the existing interface (text extraction,
  de-hyphenation, header/footer stripping) → feeds the same reader.
- **F2 — RTL languages (Hebrew, Arabic).** Mostly data + `direction.ts`; validate the
  landscape pair layout and word selection under RTL.
- **F3 — Offline dictionary (hybrid lookup).** Download per language pair into IndexedDB;
  instant gloss on tap, LLM behind "explain more" (restores the original hybrid design).
- **F4 — Paragraph/formatting/image rendering.** Use the reserved model fields to show
  paragraph grouping, light emphasis, and inline images.

---

## 7. Open assumptions

Called out so they can be corrected cheaply:
- Word tapping is available in **both** portrait and landscape.
- The **original file Blob is retained** to allow future re-processing.
- Base language stays **English** for MVP (no base-language picker yet).
- The OpenAI key living in IndexedDB on the user's own device is an accepted tradeoff;
  UI will state "your key never leaves your device."

---

## 8. Post-refresh roadmap (Phase 2)

Planned after the UI refresh. Decisions locked with the user 2026-07-13. Same
vertical-slice discipline — each slice is independently shippable and verified.

### Phase 1 — Reading surface (front-end only, no data migration)
- **1a — Fit & space.** Autosize long sentences by **measure-and-fit** (JS measures the
  rendered sentence and scales the font down until it fits the reading box; the A−/A+
  setting is the max). Reclaim wasted bottom space — expand the reading area to use the
  full height between header and footer; rebalance vertical rhythm.
- **1b — Wrap & stability.** `text-wrap: balance` (short) / `pretty` (long) on the
  sentence. Fix the **highlight layout-shift**: `.word.selected` currently adds
  horizontal padding that reflows the line — switch to a non-reflowing highlight
  (inset box-shadow / outline) so selecting a word in a long sentence doesn't jump.
- **1c — Justification setting.** New text-alignment control in Settings
  (center / left / justified) driving `.sentence`. Sets up RTL.

### Phase 2 — Segmentation architecture + alignment bug
- **2a — Segmenter registry.** New `src/segment/` mirroring the file-type parser
  registry: `pickSegmenter(lang)` → a language-specific segmenter, else a **default**.
  The default wraps `Intl.Segmenter` + a fragment-merge heuristic (folds `»«` / leading
  `—` / `1.` / scene-break fragments back into their sentence). A **German** segmenter
  adds guillemet-dialogue joins. Import calls the registry instead of raw
  `segmentSentences`. **Applies to new imports only** — existing books keep their
  sentences (protects saved highlights/quotes/positions); re-import to upgrade.
- **2b — Robust translation (alignment fix).** Root cause: `ensureWindowTranslated`
  trusts the model's returned `id` to index `pending[]`; fragmenty input makes the model
  merge/drop/renumber, caching a neighbour's English under a sentence's content-hash key
  (persistent misalignment). Fix: **keep batching**, but validate each batch (item count
  + echoed source) before caching, fall back to **single-sentence** translation for
  windows that fail validation, and bump a sentence-cache version to self-heal pairs
  already poisoned on-device.

### Phase 3 — Hebrew & Arabic (RTL)
- **3a — RTL foundations.** `ar` + `he` segmenters in the new registry (Arabic/Hebrew
  sentence punctuation), script-range language detection, Hebrew/Arabic in the import
  language list, and **bundled RTL serif faces** (self-hosted woff2 — e.g. Frank Ruhl
  Libre for Hebrew, Amiri / Noto Naskh for Arabic) since DM Serif Display has no glyphs
  for these scripts.
- **3b — RTL rendering pass.** Validate and fix `dir`-aware rendering everywhere:
  reading text, landscape pane order, progress/nav chevron direction, word-chip
  anchoring, selection, and justification under RTL. The `dir` plumbing exists from day
  one — this is the validation-and-polish pass.

**Sequence:** 1 → 2 → 3. Phase 2's segmenter registry is the plug point Phase 3 extends;
Phase 2 also closes the alignment bug. Locked build choices: measure-and-fit autosize ·
batch-with-validation translation · new-imports-only re-segmentation · bundled RTL fonts.

---

## 9. Data portability & backup (app-wide)

**The risk:** all data is on-device IndexedDB with no cloud. On iOS, deleting the
home-screen PWA **deletes its data**; storage can also be evicted under pressure/disuse
(`navigator.storage.persist()` reduces but doesn't prevent user-initiated deletion). No
cross-device sync. So a manual backup is essential.

**The feature (Settings → Back up / Restore) — a `.zip` (built/read with the already-bundled
`fflate`):**
- **Export** → a `.zip` containing `manifest.json` (version, scope, table list) + one JSON
  per Dexie table (books, sentences, chapters, translations, covers, saved words/quotes,
  highlights, vocab word bank, learn courses/units/lessons/progress/stats, settings **minus
  the OpenAI key**) + original blobs (book files, covers) stored as real files in the zip
  (not base64) so it stays compact.
- Two scopes: **Full** (includes original book files — large) or **Light** (progress +
  saved bank + word bank + learn + library metadata, no book files — small; the raw books
  can be re-imported).
- **Import** → read the `.zip`, validate the manifest version, restore/merge into IndexedDB
  (confirm before overwriting existing data).
- Round-trip is the acceptance test: export on one browser profile, import on a fresh one,
  everything reappears.

## 10. Persian (`fa`) reader support (cross-cutting with LEARN.md)

Adding Persian as a reading + learning language:
- **Direction:** `fa` is already in the RTL set (`directionFor`). ✓
- **Font:** bundle a Persian-covering face (Vazirmatn or Noto Naskh Arabic) as woff2 and
  route `fa` → it in `readingFontStack` (Amiri's Persian coverage is imperfect).
- **Detection:** distinguish `fa` from `ar` by Persian-specific letters (پ چ ژ گ ک ی) in
  `detect.ts`, since both share the Arabic Unicode block.
- **Segmentation:** the default segmenter + fragment-merge already handles Persian
  punctuation; no `fa`-specific segmenter needed initially.

---

## 11. Shared vocabulary "word bank" (cross-section foundation)

The Read and Learn sections must **talk to each other**. The connective tissue is a
per-language **word bank**: a knowledge model of what the user has encountered and how well
they know it. Built simple now; it becomes the substrate for advanced features later. Lives
in a shared module (`src/vocab/`) owned by neither section.

### Model (start simple)
```ts
interface VocabEntry {
  id: string           // `${lang}:${lemma}`
  lang: string         // target language
  lemma: string        // normalized key (lowercased surface form for now; real
                       // lemmatization is a fast-follow)
  surface?: string     // an example form actually seen
  gloss?: string       // best-known base-language meaning
  seen: number         // total encounters
  correct: number      // Learn: answered correctly
  incorrect: number
  status: 'new' | 'learning' | 'known'   // familiarity (simple rules over the counts)
  firstSeenAt: number
  lastSeenAt: number
  sources: ('reader' | 'learn' | 'saved')[]
}
```

### Who writes (both sections, from day one)
- **Reader:** tapping/glossing a word, or saving it, upserts an entry (`seen++`, records
  `gloss`, adds source `reader`/`saved`).
- **Learn:** a word appearing in an exercise upserts (`seen++`); a graded answer bumps
  `correct`/`incorrect`; source `learn`. `status` is derived from the counts.

### Who reads (enables the future features the user named)
- **Reader → pre-gloss:** while reading, auto-gloss words whose `status` is `new`/`learning`
  (skip `known` ones) — "knowing what the user doesn't know."
- **Learn → create lesson from word bank:** feed weak/`learning` words into the generator
  prompt (or a built-in practice generator) to make targeted lessons.
- **Stats:** vocabulary size per language, growth over time.

### Principles
- **Language-keyed** so multi-language study stays separate; the same lemma in two languages
  is two entries.
- **Consistent normalization** shared by both sections so a word learned in Learn matches
  the same word tapped in the reader.
- **Build v0 early** (a Dexie table + upsert API, wired into the reader's word-tap and Learn
  L2 exercises) so real data accumulates before the advanced readers are built.
