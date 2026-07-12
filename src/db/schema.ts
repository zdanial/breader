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
  }
}

export const db = new BreaderDB()
