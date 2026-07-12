import { db, type Book, type Chapter, type Sentence } from '../db/schema'
import { detectLanguage } from '../lang/detect'
import { directionFor } from '../lang/direction'
import { pickParser } from './registry'
import { segmentSentences } from './segmenter'
import type { ParsedDoc } from './types'

export interface ImportPreview {
  file: File
  format: 'txt' | 'epub'
  parsed: ParsedDoc
  suggestedLang?: string
}

/** Parse the file and suggest a language; the user confirms before commit. */
export async function prepareImport(file: File): Promise<ImportPreview> {
  const parser = pickParser(file)
  const parsed = await parser.parse(file)
  const sample = parsed.chapters
    .flatMap((c) => c.paragraphs)
    .join(' ')
    .slice(0, 20000)
  const suggestedLang = parsed.language ?? detectLanguage(sample)
  return { file, format: parser.format, parsed, suggestedLang }
}

/** Segment and persist a prepared import. Returns the new book id. */
export async function commitImport(
  preview: ImportPreview,
  opts: { title: string; targetLang: string },
): Promise<string> {
  const bookId = crypto.randomUUID()

  const sentences: Sentence[] = []
  const chapters: Chapter[] = []
  let index = 0
  preview.parsed.chapters.forEach((chapter, chapterIndex) => {
    chapters.push({ bookId, index: chapterIndex, title: chapter.title, startSentenceIndex: index })
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      for (const text of segmentSentences(paragraph, opts.targetLang)) {
        sentences.push({ id: `${bookId}:${index}`, bookId, index, chapterIndex, paragraphIndex, text })
        index++
      }
    })
  })
  if (sentences.length === 0) throw new Error('No readable text found in file')

  const book: Book = {
    id: bookId,
    title: opts.title.trim() || preview.parsed.title,
    author: preview.parsed.author,
    format: preview.format,
    targetLang: opts.targetLang,
    baseLang: 'en',
    dir: directionFor(opts.targetLang),
    sentenceCount: sentences.length,
    positionIndex: 0,
    createdAt: Date.now(),
  }

  await db.transaction('rw', [db.books, db.sentences, db.chapters, db.files], async () => {
    await db.books.add(book)
    await db.sentences.bulkAdd(sentences)
    await db.chapters.bulkAdd(chapters)
    // keep the original so a future parser version can re-process without re-import
    await db.files.add({ bookId, name: preview.file.name, blob: preview.file })
  })

  return bookId
}
