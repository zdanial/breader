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

// ── The bank: saved words, quotes, highlights ────────────────────────────────
// Words and quotes are the reader's learning record: they keep a denormalized
// book title and SURVIVE book deletion (bookId is stripped, jump-back disabled).
// Highlights belong to the text itself and are removed with their book.

export interface SavedWord {
  id: string
  text: string // word or phrase as selected
  translation?: string // snapshot of the cached translation, if available
  sentence: string // context sentence
  targetLang: string
  bookId?: string
  bookTitle: string
  createdAt: number
}

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

export interface VocabEntry {
  id: string // `${lang}:${lemma}`
  lang: string // target language
  lemma: string // normalized key (lowercased surface form for now)
  surface?: string // an example form actually seen
  gloss?: string // best-known base-language meaning
  seen: number
  correct: number
  incorrect: number
  status: 'new' | 'learning' | 'known'
  firstSeenAt: number
  lastSeenAt: number
  sources: Array<'reader' | 'learn' | 'saved'>
}

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
  xp: number
  totalExercises: number
  totalCorrect: number
  totalTimeMs: number
  activeDays: string[]
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
  savedWords!: Table<SavedWord, string>
  savedQuotes!: Table<SavedQuote, string>
  highlights!: Table<Highlight, string>
  vocab!: Table<VocabEntry, string>
  learnCourses!: Table<LearnCourse, string>
  learnUnits!: Table<LearnUnit, string>
  learnLessons!: Table<LearnLesson, string>
  learnProgress!: Table<LearnProgress, string>
  learnStats!: Table<LearnStats, string>
  learnFiles!: Table<LearnFile, string>
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
  }
}

export const db = new BreaderDB()
