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
  collapsedLangs?: string[] // library sections the user has folded shut
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
  }
}

export const db = new BreaderDB()
