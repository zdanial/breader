// A per-category estimate of on-device storage use, for the Settings screen.
// Blob-backed tables (files, covers, audio) are summed exactly by blob size;
// text tables are estimated by the UTF-8 byte length of their JSON. IndexedDB's
// real on-disk size is implementation-specific, so treat this as approximate.
import { db } from './schema'

export interface StorageCategory {
  key: string
  label: string
  bytes: number
}

/** Exact byte total of the blobs in a table (metadata is negligible). */
async function blobBytes(table: string): Promise<number> {
  let bytes = 0
  await db.table(table).each((row: { blob?: Blob }) => {
    if (row.blob instanceof Blob) bytes += row.blob.size
  })
  return bytes
}

/** Estimated byte size of a table's rows via one JSON serialization. */
async function jsonBytes(table: string): Promise<number> {
  const rows = await db.table(table).toArray()
  if (rows.length === 0) return 0
  return new Blob([JSON.stringify(rows)]).size
}

/** Per-category storage estimate, largest first, empties dropped. */
export async function storageBreakdown(): Promise<StorageCategory[]> {
  const [
    files, covers, sentences, chapters, books,
    translations, audio,
    learnFiles, courses, units, lessons, progress, stats, daily,
    vocab, quotes, highlights,
  ] = await Promise.all([
    blobBytes('files'), blobBytes('covers'), jsonBytes('sentences'), jsonBytes('chapters'), jsonBytes('books'),
    jsonBytes('translations'), blobBytes('audio'),
    blobBytes('learnFiles'), jsonBytes('learnCourses'), jsonBytes('learnUnits'), jsonBytes('learnLessons'),
    jsonBytes('learnProgress'), jsonBytes('learnStats'), jsonBytes('learnDaily'),
    jsonBytes('vocab'), jsonBytes('savedQuotes'), jsonBytes('highlights'),
  ])

  return [
    { key: 'books', label: 'books', bytes: files + covers + sentences + chapters + books },
    { key: 'translations', label: 'translation cache', bytes: translations },
    { key: 'audio', label: 'audio (speech)', bytes: audio },
    {
      key: 'learn',
      label: 'learn content',
      bytes: learnFiles + courses + units + lessons + progress + stats + daily,
    },
    { key: 'bank', label: 'word bank & saved', bytes: vocab + quotes + highlights },
  ]
    .filter((c) => c.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
}
