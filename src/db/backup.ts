// App-wide data backup/restore as a .zip (DESIGN.md §9). Every Dexie table is
// dumped to JSON; blobs (book files, covers, learn files, audio) are stored as
// real files in the zip. The OpenAI key is never exported.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db } from './schema'

const ALL_TABLES = [
  'books', 'sentences', 'chapters', 'translations', 'settings', 'files', 'covers',
  'savedQuotes', 'highlights', 'vocab',
  'learnCourses', 'learnUnits', 'learnLessons', 'learnProgress', 'learnStats', 'learnFiles',
  'learnDaily', 'audio',
]
// 'light' drops the big, re-generatable data: book sentences, original files, audio.
const LIGHT_EXCLUDE = new Set(['sentences', 'files', 'audio'])

export type BackupScope = 'full' | 'light'

export async function exportBackup(scope: BackupScope): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const tables = scope === 'light' ? ALL_TABLES.filter((t) => !LIGHT_EXCLUDE.has(t)) : ALL_TABLES
  const included: string[] = []

  for (const name of tables) {
    const rows = await db.table(name).toArray()
    const serialized: unknown[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = { ...(rows[i] as Record<string, unknown>) }
      if (name === 'settings') delete row.openaiKey // never export the key
      if (row.blob instanceof Blob) {
        const path = `blobs/${name}/${i}.bin`
        files[path] = new Uint8Array(await row.blob.arrayBuffer())
        row.blob = { __blob: path, type: row.blob.type }
      }
      serialized.push(row)
    }
    files[`tables/${name}.json`] = strToU8(JSON.stringify(serialized))
    included.push(name)
  }

  files['manifest.json'] = strToU8(
    JSON.stringify({ app: 'panglossa', version: 1, scope, createdAt: Date.now(), tables: included }),
  )
  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' })
}

export async function importBackup(file: File): Promise<{ tables: number; rows: number }> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('Could not read the .zip')
  }
  const manifestRaw = entries['manifest.json']
  if (!manifestRaw) throw new Error('Not a Panglossa backup (missing manifest)')
  const manifest = JSON.parse(strFromU8(manifestRaw)) as { version: number; tables: string[] }
  if (manifest.version !== 1) throw new Error('Unsupported backup version')

  const existingKey = (await db.settings.get('singleton'))?.openaiKey
  let rowCount = 0

  for (const name of manifest.tables) {
    const raw = entries[`tables/${name}.json`]
    if (!raw) continue
    const rows = JSON.parse(strFromU8(raw)) as Array<Record<string, unknown>>
    for (const row of rows) {
      const b = row.blob as { __blob?: string; type?: string } | undefined
      if (b && b.__blob && entries[b.__blob]) {
        row.blob = new Blob([entries[b.__blob] as BlobPart], { type: b.type })
      }
      if (name === 'settings') row.openaiKey = existingKey // keep this device's key
    }
    await db.table(name).bulkPut(rows)
    rowCount += rows.length
  }
  return { tables: manifest.tables.length, rows: rowCount }
}
