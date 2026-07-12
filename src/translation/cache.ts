// Content-addressed translation cache (DESIGN.md §3): the key hashes
// kind + languages + model + source text (+ context), so cache entries
// survive re-imports and never collide across models.
import { db, type Translation } from '../db/schema'

export async function cacheKey(parts: unknown[]): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(parts))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const getCached = (key: string): Promise<Translation | undefined> => db.translations.get(key)

export const putCached = (entry: Translation): Promise<string> => db.translations.put(entry)
