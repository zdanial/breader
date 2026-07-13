// Word bank, quote bank, highlights (DESIGN decision: words/quotes survive
// book deletion; highlights are removed with their book).
import { db, type Book, type Highlight, type Sentence } from './schema'
import { getCached } from '../translation/cache'
import { sentenceKey } from '../translation/sentenceTranslator'

export async function saveWord(entry: {
  text: string
  translation?: string
  sentence: string
  targetLang: string
  bookId: string
  bookTitle: string
}): Promise<void> {
  await db.savedWords.add({ id: crypto.randomUUID(), createdAt: Date.now(), ...entry })
}

export const deleteSavedWord = (id: string) => db.savedWords.delete(id)
export const deleteSavedQuote = (id: string) => db.savedQuotes.delete(id)

/** Is the current sentence already in the quote bank? Returns its id if so. */
export async function quoteIdFor(bookId: string, sentenceIndex: number): Promise<string | undefined> {
  const existing = await db.savedQuotes
    .where('[bookId+sentenceIndex]')
    .equals([bookId, sentenceIndex])
    .first()
  return existing?.id
}

/** Bookmark toggle: save the current sentence as a quote, or remove it. */
export async function toggleQuote(
  book: Book,
  sentence: Sentence,
  model: string,
): Promise<'saved' | 'removed'> {
  const existingId = await quoteIdFor(book.id, sentence.index)
  if (existingId) {
    await db.savedQuotes.delete(existingId)
    return 'removed'
  }
  // snapshot the translation if it's already cached (no network call here)
  const key = await sentenceKey(sentence.text, book.targetLang, model)
  const cached = await getCached(key)
  await db.savedQuotes.add({
    id: crypto.randomUUID(),
    text: sentence.text,
    translation: cached?.result,
    targetLang: book.targetLang,
    bookId: book.id,
    bookTitle: book.title,
    author: book.author,
    sentenceIndex: sentence.index,
    createdAt: Date.now(),
  })
  return 'saved'
}

export async function addHighlight(entry: {
  bookId: string
  sentenceId: string
  sentenceIndex: number
  start: number
  end: number
  text: string
}): Promise<void> {
  await db.highlights.add({ id: crypto.randomUUID(), createdAt: Date.now(), ...entry })
}

export const removeHighlight = (id: string) => db.highlights.delete(id)

/** The highlight exactly matching a selection range, if any (used for toggling). */
export function findExactHighlight(
  highlights: Highlight[] | undefined,
  start: number,
  end: number,
): Highlight | undefined {
  return highlights?.find((h) => h.start === start && h.end === end)
}
