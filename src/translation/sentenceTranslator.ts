// Lazy, windowed sentence translation (DESIGN.md): translate the current
// sentence plus a small look-ahead in ONE structured call, cache each result
// individually and permanently. Content-addressed keys mean re-reads,
// re-imports, and rotation never re-pay.
import { db, type Book, type Sentence } from '../db/schema'
import { cacheKey, getCached, putCached } from './cache'
import { chatComplete, TxError } from './openaiClient'
import { langName } from './wordTranslator'

export const PREFETCH_WINDOW = 6

export function sentenceKey(text: string, targetLang: string, model: string): Promise<string> {
  return cacheKey(['sentence', targetLang, 'en', model, text])
}

// keys currently being fetched — overlapping windows skip instead of re-requesting
const inFlight = new Set<string>()

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

  const pending: Array<{ sentence: Sentence; key: string }> = []
  for (const sentence of sentences) {
    const key = await sentenceKey(sentence.text, book.targetLang, opts.model)
    if (inFlight.has(key) || (await getCached(key))) continue
    pending.push({ sentence, key })
  }
  if (pending.length === 0) return

  pending.forEach((p) => inFlight.add(p.key))
  try {
    const payload = { sentences: pending.map((p, i) => ({ id: i, text: p.sentence.text })) }
    // generous per-sentence budget; literary sentences (Kant!) run long
    const maxTokens = Math.min(
      4000,
      pending.reduce((n, p) => n + 60 + p.sentence.text.split(/\s+/).length * 3, 100),
    )
    const raw = await chatComplete({
      apiKey: opts.apiKey,
      model: opts.model,
      json: true,
      maxTokens,
      system: `You translate ${langName(book.targetLang)} literature into natural, faithful English. Reply only with JSON.`,
      user: `Translate each sentence into English. Return JSON of the form {"translations":[{"id":<same id>,"text":"<English translation>"}]} with one entry per input sentence.\n\n${JSON.stringify(payload)}`,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new TxError('bad-response', 'Model did not return valid JSON')
    }
    const list = (parsed as { translations?: unknown })?.translations
    if (!Array.isArray(list)) throw new TxError('bad-response', 'Missing translations array')

    // items are matched by id, so a dropped/reordered entry can't misalign the rest
    for (const item of list as Array<{ id?: unknown; text?: unknown }>) {
      const match = typeof item?.id === 'number' ? pending[item.id] : undefined
      if (!match || typeof item.text !== 'string' || !item.text.trim()) continue
      await putCached({
        key: match.key,
        kind: 'sentence',
        sourceText: match.sentence.text,
        result: item.text.trim(),
        model: opts.model,
        bookId: book.id,
        createdAt: Date.now(),
      })
    }
  } finally {
    pending.forEach((p) => inFlight.delete(p.key))
  }
}
