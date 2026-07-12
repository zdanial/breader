import { db } from './schema'

/** Remove a book and everything derived from it (sentences, chapters, original
 *  file, and its cached translations). */
export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.books, db.sentences, db.chapters, db.files, db.translations],
    async () => {
      await db.sentences.where('bookId').equals(bookId).delete()
      await db.chapters.where('bookId').equals(bookId).delete()
      await db.translations.where('bookId').equals(bookId).delete()
      await db.files.delete(bookId)
      await db.books.delete(bookId)
    },
  )
}

/** Drop a book's cached translations (they re-fetch lazily on next read). */
export function clearBookTranslations(bookId: string): Promise<number> {
  return db.translations.where('bookId').equals(bookId).delete()
}
