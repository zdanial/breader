import Dexie, { type Table } from 'dexie'

// ── Domain types (see DESIGN.md §3) ──────────────────────────────────────────

export interface Book {
  id: string
  title: string
  author?: string
  format: 'txt' | 'epub' // 'pdf' later
  targetLang: string // BCP-47, e.g. 'de', 'fr'
  baseLang: 'en' // fixed for MVP
  dir: 'ltr' | 'rtl'
  sentenceCount: number
  positionIndex: number // resume point (global sentence index)
  createdAt: number
}

export interface Sentence {
  id: string // `${bookId}:${index}`
  bookId: string
  index: number // global order within the book
  chapterIndex: number
  paragraphIndex: number // reserved for paragraph-preserving fast-follow
  text: string
}

export interface Chapter {
  bookId: string
  index: number
  title: string
  startSentenceIndex: number
}

export interface Translation {
  key: string // hash(kind + langs + model + sourceText [+ context])
  kind: 'sentence' | 'word' | 'phrase' | 'explain'
  sourceText: string
  result: string
  context?: string
  model: string
  bookId?: string // provenance, so a book's cache can be cleared with it
  createdAt: number
}

export interface Settings {
  id: 'singleton'
  openaiKey?: string // stored on-device only
  model: string
  theme: 'system' | 'light' | 'dark'
  fontScale: number
  fontFamily: string
  readAlign?: 'center' | 'left' | 'justify' // reading text alignment
  accentColor?: string // signal accent, drives --accent
  ttsVoice?: string // OpenAI TTS voice
  collapsedLangs?: string[] // library sections the user has folded shut
  lastReadBookId?: string // the 'currently reading' book (live indicator)
}

export interface CoverImage {
  bookId: string
  blob: Blob
}

// ── The bank: quotes + highlights ────────────────────────────────────────────
// Single saved words live in the shared word bank (`vocab`, §11) now — this is
// the multi-word record. Quotes keep a denormalized book title and SURVIVE book
// deletion (bookId is stripped, jump-back disabled). Highlights belong to the
// text itself and are removed with their book.

export interface SavedQuote {
  id: string
  text: string // the full sentence
  translation?: string
  targetLang: string
  bookId?: string
  bookTitle: string
  author?: string
  sentenceIndex: number
  createdAt: number
}

export interface Highlight {
  id: string
  bookId: string
  sentenceId: string // `${bookId}:${index}`
  sentenceIndex: number
  start: number // token indices, inclusive
  end: number
  text: string
  createdAt: number
}

export interface StoredFile {
  bookId: string
  name: string
  blob: Blob // original import, kept for future re-parsing
}

// ── Shared vocabulary "word bank" (DESIGN.md §11) ────────────────────────────
// Per-language knowledge model both Read and Learn write to and can read from.
// The substrate for future pre-gloss + create-lesson-from-word-bank features.

export interface VocabOrigin {
  channel: 'reader' | 'learn'
  bookId?: string
  courseId?: string
  unitId?: string
  context?: string // the sentence the word first appeared in
}

export interface VocabEntry {
  id: string // `${lang}:${lemma}`
  lang: string // target language (primary subtag)
  lemma: string // normalized surface-form key
  surface?: string // an example form actually seen (keeps script/case)
  gloss?: string // best-known base-language meaning — required to build review
  root?: string // reserved for the future forms-connector (null in v1)

  // Anki-style SM-2 scheduler, auto-graded from outcomes (no rating buttons)
  tracked: boolean // scheduled review card vs. logged-only exposure
  ease: number // SM-2 ease factor (default 2.5, floor 1.3)
  intervalDays: number // current review interval
  dueAt?: number // next-review timestamp (ms); absent when not tracked
  reps: number // consecutive successful reviews
  lapses: number // times reset by a miss
  lastGrade?: 0 | 1 | 2 | 3 // Again | Hard | Good | Easy
  lastReviewedAt?: number

  // exposure + provenance
  seen: number
  correct: number
  incorrect: number
  lookups: number // reader look-ups; promotes to tracked at >= 2
  firstSeenAt: number
  lastSeenAt: number
  origin?: VocabOrigin // first-seen provenance
  sources: Array<'reader' | 'learn' | 'saved'>
}
// status (new/learning/known) is derived from reps/intervalDays — see vocab/bank

// ── Learn section (see LEARN.md) ─────────────────────────────────────────────

export interface LearnCourse {
  id: string
  title: string
  targetLang: string
  baseLang: string
  dir: 'ltr' | 'rtl'
  createdAt: number
}

export interface LearnUnit {
  id: string
  courseId: string
  index: number
  title: string
  glossary?: Array<{ word: string; gloss: string; note?: string }>
}

// A lesson item is a teaching screen or one of the graded exercise types.
export type LessonItem =
  | { type: 'teach'; title: string; body: string; examples?: Array<[string, string]>; note?: string }
  | { type: 'choice'; prompt: string; choices: string[]; answer: number; note?: string; translation?: string }
  | { type: 'build'; prompt: string; tiles: string[]; answer: string[]; accept?: string[][]; note?: string }
  | { type: 'match'; pairs: Array<[string, string]>; note?: string }
  | { type: 'blank'; prompt: string; choices: string[]; answer: number; translation?: string; note?: string }
  // listen: hear the spoken target `text`, rebuild it from `tiles` (graded like build)
  | { type: 'listen'; text: string; tiles: string[]; answer: string[]; accept?: string[][]; translation?: string; note?: string }
  // read: a writing sample (poem/story) read with the reader UX — tap words to gloss,
  // play audio, optional translation. No input (like teach).
  | { type: 'read'; title?: string; text: string; translation?: string; note?: string }

export interface LearnLesson {
  id: string
  unitId: string
  courseId: string
  index: number
  title: string
  items: LessonItem[]
}

export interface LearnProgress {
  lessonId: string
  courseId: string
  unitId: string
  completed: boolean
  bestAccuracy: number
  attempts: number
  lastAt: number
}

export interface LearnStats {
  id: 'singleton'
  totalExercises: number
  totalCorrect: number
  totalTimeMs: number
  activeDays: string[]
}

// Per-language, per-day rollup — powers over-time and by-language stats.
export interface LearnDaily {
  id: string // `${lang}:${day}`
  lang: string
  day: string // YYYY-MM-DD
  exercises: number
  correct: number
  timeMs: number
}

export interface LearnFile {
  id: string // course fragment id (uuid) — the original imported json/zip retained
  name: string
  blob: Blob
  createdAt: number
}

// Cached TTS audio, keyed by hash(model + voice + text). Permanent on-device.
export interface AudioClip {
  key: string
  blob: Blob
  createdAt: number
}

// ── Database ─────────────────────────────────────────────────────────────────

class BreaderDB extends Dexie {
  books!: Table<Book, string>
  sentences!: Table<Sentence, string>
  chapters!: Table<Chapter, [string, number]>
  translations!: Table<Translation, string>
  settings!: Table<Settings, string>
  files!: Table<StoredFile, string>
  covers!: Table<CoverImage, string>
  savedQuotes!: Table<SavedQuote, string>
  highlights!: Table<Highlight, string>
  vocab!: Table<VocabEntry, string>
  learnCourses!: Table<LearnCourse, string>
  learnUnits!: Table<LearnUnit, string>
  learnLessons!: Table<LearnLesson, string>
  learnProgress!: Table<LearnProgress, string>
  learnStats!: Table<LearnStats, string>
  learnFiles!: Table<LearnFile, string>
  learnDaily!: Table<LearnDaily, string>
  audio!: Table<AudioClip, string>

  constructor() {
    super('breader')
    this.version(1).stores({
      books: 'id, createdAt',
      sentences: 'id, bookId, [bookId+index]',
      chapters: '[bookId+index], bookId',
      translations: 'key, createdAt',
      settings: 'id',
      files: 'bookId',
    })
    // v2: index translations by originating book so a book's cache can be cleared
    this.version(2).stores({
      translations: 'key, createdAt, bookId',
    })
    // v3: extracted cover images
    this.version(3).stores({
      covers: 'bookId',
    })
    // v4: word bank, quote bank, highlights
    this.version(4).stores({
      savedWords: 'id, createdAt, targetLang, bookId',
      savedQuotes: 'id, createdAt, targetLang, bookId, [bookId+sentenceIndex]',
      highlights: 'id, sentenceId, bookId',
    })
    // v5: shared vocabulary word bank (reader ↔ learn)
    this.version(5).stores({
      vocab: 'id, lang, status, lastSeenAt, [lang+status]',
    })
    // v6: Learn section — courses/units/lessons/progress/stats
    this.version(6).stores({
      learnCourses: 'id, targetLang, createdAt',
      learnUnits: 'id, courseId, [courseId+index]',
      learnLessons: 'id, unitId, courseId, [unitId+index]',
      learnProgress: 'lessonId, courseId, unitId',
      learnStats: 'id',
      learnFiles: 'id, createdAt',
    })
    // v7: cached TTS audio
    this.version(7).stores({
      audio: 'key, createdAt',
    })
    // v8: per-language/day stats rollup
    this.version(8).stores({
      learnDaily: 'id, day, lang',
    })
    // v9: word bank v1 (DESIGN.md §11) — SM-2 scheduler fields on vocab, merge
    // savedWords in, drop xp. Index by [lang+dueAt] (untracked rows have no
    // dueAt, so they fall out of the index — the tracked/review pool for free).
    this.version(9)
      .stores({
        vocab: 'id, lang, dueAt, lastSeenAt, [lang+dueAt]',
        savedWords: null, // merged into vocab
      })
      .upgrade(async (tx) => {
        const DAY = 86_400_000
        const now = Date.now()
        const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
        const prim = (l: string) => (l ?? '').toLowerCase().split('-')[0]

        // 1. upgrade existing vocab rows to the SM-2 shape
        await tx
          .table('vocab')
          .toCollection()
          .modify((v: Record<string, unknown>) => {
            const sources = Array.isArray(v.sources) ? (v.sources as string[]) : []
            const status = v.status as string | undefined
            const intent = sources.includes('learn') || sources.includes('saved')
            v.tracked = intent
            v.ease = 2.5
            v.reps = status === 'known' ? 2 : status === 'learning' ? 1 : 0
            v.lapses = 0
            v.intervalDays = status === 'known' ? 7 : status === 'learning' ? 1 : 0
            v.lookups = sources.includes('reader') ? ((v.seen as number) ?? 0) : 0
            if (intent) {
              const last = (v.lastSeenAt as number) ?? now
              v.dueAt = Math.max(now, last + (v.intervalDays as number) * DAY)
            }
            delete v.status
          })

        // 2. merge savedWords → vocab (single words become tracked entries;
        //    multi-word saves become phrase quotes so nothing is lost)
        const saved = await tx.table('savedWords').toArray()
        for (const s of saved) {
          const lang = prim(s.targetLang)
          const single = !/\s/.test((s.text ?? '').trim())
          if (single) {
            const lemma = norm(s.text ?? '')
            if (!lemma) continue
            const id = `${lang}:${lemma}`
            const prev = (await tx.table('vocab').get(id)) as Record<string, unknown> | undefined
            const base: Record<string, unknown> = prev ?? {
              id, lang, lemma, seen: 0, correct: 0, incorrect: 0, lookups: 0,
              ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, tracked: false,
              firstSeenAt: s.createdAt ?? now, lastSeenAt: s.createdAt ?? now, sources: [],
            }
            base.surface = base.surface ?? s.text
            if (s.translation && !base.gloss) base.gloss = s.translation
            base.tracked = true
            if (base.dueAt == null) { base.intervalDays = 0; base.dueAt = now }
            const src = base.sources as string[]
            if (!src.includes('saved')) src.push('saved')
            if (!base.origin) base.origin = { channel: 'reader', bookId: s.bookId, context: s.sentence }
            await tx.table('vocab').put(base)
          } else {
            await tx.table('savedQuotes').put({
              id: s.id ?? crypto.randomUUID(),
              text: s.text, translation: s.translation, targetLang: s.targetLang,
              bookId: s.bookId, bookTitle: s.bookTitle, author: undefined,
              sentenceIndex: -1, createdAt: s.createdAt ?? now,
            })
          }
        }

        // 3. drop xp
        await tx.table('learnStats').toCollection().modify((r: Record<string, unknown>) => { delete r.xp })
        await tx.table('learnDaily').toCollection().modify((r: Record<string, unknown>) => { delete r.xp })
      })
  }
}

export const db = new BreaderDB()
