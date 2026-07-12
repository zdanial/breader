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
