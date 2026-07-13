// Lazy, windowed sentence translation. Translate the current sentence plus a
// small look-ahead in ONE structured call; cache each result individually and
// permanently (content-addressed keys → re-reads, re-imports, rotation never
// re-pay). A batch is trusted only if it returns exactly one entry per input
// with the ids intact; otherwise we fall back to single-sentence calls, so a
// model that merges/drops/renumbers can never misalign target and base.
import { db, type Book, type Sentence } from '../db/schema'
import { cacheKey, getCached, putCached } from './cache'
import { chatComplete, TxError } from './openaiClient'
import { langName } from './wordTranslator'

export const PREFETCH_WINDOW = 6

// Bump to invalidate previously-cached sentence translations (e.g. after a fix
// that could have poisoned pairs). v2: robust batch validation + fallback.
const SENTENCE_CACHE_VERSION = 'v2'

export function sentenceKey(text: string, targetLang: string, model: string): Promise<string> {
  return cacheKey(['sentence', SENTENCE_CACHE_VERSION, targetLang, 'en', model, text])
}

// keys currently being fetched — overlapping windows skip instead of re-requesting
const inFlight = new Set<string>()

type Pending = { sentence: Sentence; key: string }

/** Translate and cache one sentence with an independent call (fallback path). */
async function translateOne(book: Book, p: Pending, opts: { model: string; apiKey?: string }) {
  const result = await chatComplete({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: Math.min(1200, 80 + p.sentence.text.split(/\s+/).length * 4),
    system: `You translate ${langName(book.targetLang)} literature into natural, faithful English.`,
    user: `Translate this ${langName(book.targetLang)} sentence into English. Reply with only the translation, nothing else.\n\n${p.sentence.text}`,
  })
  await putCached({
    key: p.key,
    kind: 'sentence',
    sourceText: p.sentence.text,
    result: result.trim(),
    model: opts.model,
    bookId: book.id,
    createdAt: Date.now(),
  })
}

/** True only if the batch is trustworthy: one entry per input, ids a full
 *  permutation of 0..n-1, every text a non-empty string. */
function isCleanBatch(list: Array<{ id?: unknown; text?: unknown }>, n: number): boolean {
  if (list.length !== n) return false
  const seen = new Set<number>()
  for (const item of list) {
    if (typeof item?.id !== 'number' || item.id < 0 || item.id >= n) return false
    if (seen.has(item.id)) return false
    if (typeof item.text !== 'string' || !item.text.trim()) return false
    seen.add(item.id)
  }
  return seen.size === n
}

/**
 * Ensure sentences [startIndex, startIndex + window) are translated and cached.
 * Only uncached, not-in-flight sentences are sent, batched into a single call.
 */
export async function ensureWindowTranslated(
  book: Book,
  startIndex: number,
  opts: { model: string; apiKey?: string },
): Promise<void> {
  const end = Math.min(startIndex + PREFETCH_WINDOW, book.sentenceCount)
  if (startIndex >= end) return
  const sentences = await db.sentences
    .where('[bookId+index]')
    .between([book.id, startIndex], [book.id, end], true, false)
    .toArray()

  const pending: Pending[] = []
  for (const sentence of sentences) {
    const key = await sentenceKey(sentence.text, book.targetLang, opts.model)
    if (inFlight.has(key) || (await getCached(key))) continue
    pending.push({ sentence, key })
  }
  if (pending.length === 0) return

  pending.forEach((p) => inFlight.add(p.key))
  try {
    const payload = { sentences: pending.map((p, i) => ({ id: i, text: p.sentence.text })) }
    const maxTokens = Math.min(
      4000,
      pending.reduce((n, p) => n + 60 + p.sentence.text.split(/\s+/).length * 3, 100),
    )

    let clean = false
    try {
      const raw = await chatComplete({
        apiKey: opts.apiKey,
        model: opts.model,
        json: true,
        maxTokens,
        system: `You translate ${langName(book.targetLang)} literature into natural, faithful English. Reply only with JSON.`,
        user: `Translate each sentence into English. Return JSON {"translations":[{"id":<same id>,"text":"<English>"}]} with EXACTLY one entry per input sentence, keeping each id. Never merge, split, drop, or reorder sentences.\n\n${JSON.stringify(payload)}`,
      })
      const parsed = JSON.parse(raw) as { translations?: unknown }
      const list = parsed?.translations
      if (Array.isArray(list) && isCleanBatch(list as never[], pending.length)) {
        for (const item of list as Array<{ id: number; text: string }>) {
          const p = pending[item.id]
          await putCached({
            key: p.key,
            kind: 'sentence',
            sourceText: p.sentence.text,
            result: item.text.trim(),
            model: opts.model,
            bookId: book.id,
            createdAt: Date.now(),
          })
        }
        clean = true
      }
    } catch {
      // parse/JSON/network error → fall through to single-sentence path
    }

    // untrusted batch (miscount, renumber, bad JSON): translate each on its own,
    // which is correct by construction. Best-effort per sentence.
    if (!clean) {
      let lastErr: unknown = null
      for (const p of pending) {
        if (await getCached(p.key)) continue
        try {
          await translateOne(book, p, opts)
        } catch (e) {
          lastErr = e
        }
      }
      if (lastErr) throw lastErr instanceof TxError ? lastErr : new TxError('http', 'Translation failed')
    }
  } finally {
    pending.forEach((p) => inFlight.delete(p.key))
  }
}
