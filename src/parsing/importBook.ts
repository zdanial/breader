import { db, type Book, type Chapter, type Sentence } from '../db/schema'
import { directionFor } from '../lang/direction'
import { pickParser } from './registry'
import { segmentSentences } from './segmenter'

/** Parse, segment, and persist a book. Returns the new book id. */
export async function importBook(file: File, targetLang: string): Promise<string> {
  const parser = pickParser(file)
  const parsed = await parser.parse(file)
  const bookId = crypto.randomUUID()

  const sentences: Sentence[] = []
  const chapters: Chapter[] = []
  let index = 0
  parsed.chapters.forEach((chapter, chapterIndex) => {
    chapters.push({ bookId, index: chapterIndex, title: chapter.title, startSentenceIndex: index })
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      for (const text of segmentSentences(paragraph, targetLang)) {
        sentences.push({ id: `${bookId}:${index}`, bookId, index, chapterIndex, paragraphIndex, text })
        index++
      }
    })
  })
  if (sentences.length === 0) throw new Error('No readable text found in file')

  const book: Book = {
    id: bookId,
    title: parsed.title,
    author: parsed.author,
    format: parser.format,
    targetLang,
    baseLang: 'en',
    dir: directionFor(targetLang),
    sentenceCount: sentences.length,
    positionIndex: 0,
    createdAt: Date.now(),
  }

  await db.transaction('rw', [db.books, db.sentences, db.chapters, db.files], async () => {
    await db.books.add(book)
    await db.sentences.bulkAdd(sentences)
    await db.chapters.bulkAdd(chapters)
    // keep the original so a future parser version can re-process without re-import
    await db.files.add({ bookId, name: file.name, blob: file })
  })

  return bookId
}
