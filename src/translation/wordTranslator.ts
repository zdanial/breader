import type { Translation } from '../db/schema'
import { cacheKey, getCached, putCached } from './cache'
import { chatComplete } from './openaiClient'

export const langName = (code: string): string =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

export interface Lookup {
  text: string // the tapped word or selected phrase
  sentence: string // full sentence context
  targetLang: string
  model: string
  apiKey?: string
  bookId?: string
}

// One request per cache key at a time: repeat taps (and React StrictMode's
// double-fired dev effects) share the in-flight promise instead of re-calling OpenAI.
const inFlight = new Map<string, Promise<string>>()

async function cachedLookup(
  kind: Translation['kind'],
  req: Lookup,
  run: () => Promise<string>,
): Promise<string> {
  const key = await cacheKey([kind, req.targetLang, 'en', req.model, req.text, req.sentence])
  const hit = await getCached(key)
  if (hit) return hit.result

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = run()
    .then(async (result) => {
      await putCached({
        key,
        kind,
        sourceText: req.text,
        context: req.sentence,
        result,
        model: req.model,
        bookId: req.bookId,
        createdAt: Date.now(),
      })
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Contextual gloss for a tapped word. Cached permanently on-device. */
export function translateWord(req: Lookup): Promise<string> {
  return cachedLookup('word', req, () =>
    chatComplete({
      apiKey: req.apiKey,
      model: req.model,
      maxTokens: 120,
      system: `You are a concise bilingual reading assistant helping an English speaker read ${langName(req.targetLang)}.`,
      user: `Sentence: "${req.sentence}"\n\nWhat does "${req.text}" mean in this sentence? Answer with the English meaning only, in at most one short line. If it is an inflected form, add the base form in parentheses.`,
    }),
  )
}

/** Translation of a multi-word span, as a unit. Cached permanently on-device. */
export function translatePhrase(req: Lookup): Promise<string> {
  return cachedLookup('phrase', req, () =>
    chatComplete({
      apiKey: req.apiKey,
      model: req.model,
      maxTokens: 160,
      system: `You are a concise bilingual reading assistant helping an English speaker read ${langName(req.targetLang)}.`,
      user: `Sentence: "${req.sentence}"\n\nWhat does the phrase "${req.text}" mean in this sentence? Answer with the natural English equivalent only, in at most one short line.`,
    }),
  )
}

/** Deeper on-demand explanation (grammar, form, usage). Cached permanently on-device. */
export function explainSelection(req: Lookup): Promise<string> {
  return cachedLookup('explain', req, () =>
    chatComplete({
      apiKey: req.apiKey,
      model: req.model,
      maxTokens: 280,
      system: `You are a bilingual reading tutor for an English speaker learning ${langName(req.targetLang)}. Be concrete and brief.`,
      user: `Sentence: "${req.sentence}"\n\nExplain "${req.text}" as used here: meaning, base form and grammar (case/tense/agreement if relevant), and why this form appears in this sentence. At most 3 short sentences.`,
    }),
  )
}
