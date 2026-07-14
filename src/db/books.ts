import { db } from './schema'

/** Remove a book and everything derived from it (sentences, chapters, original
 *  file, and its cached translations). */
export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.books,
      db.sentences,
      db.chapters,
      db.files,
      db.translations,
      db.covers,
      db.highlights,
      db.savedQuotes,
      db.vocab,
    ],
    async () => {
      await db.sentences.where('bookId').equals(bookId).delete()
      await db.chapters.where('bookId').equals(bookId).delete()
      await db.translations.where('bookId').equals(bookId).delete()
      await db.highlights.where('bookId').equals(bookId).delete()
      // the bank survives deletion — just detach so jump-back knows it's gone
      await db.savedQuotes.where('bookId').equals(bookId).modify({ bookId: undefined })
      // word-bank entries keep their provenance but lose the dead book ref
      await db.vocab.filter((v) => v.origin?.bookId === bookId).modify((v) => {
        if (v.origin) v.origin.bookId = undefined
      })
      await db.files.delete(bookId)
      await db.covers.delete(bookId)
      await db.books.delete(bookId)
    },
  )
}

/** Drop a book's cached translations (they re-fetch lazily on next read). */
export function clearBookTranslations(bookId: string): Promise<number> {
  return db.translations.where('bookId').equals(bookId).delete()
}
