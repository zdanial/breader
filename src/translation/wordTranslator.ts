import { cacheKey, getCached, putCached } from './cache'
import { chatComplete } from './openaiClient'

export const langName = (code: string): string =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

export interface WordLookup {
  word: string
  sentence: string // full sentence context
  targetLang: string
  model: string
  apiKey?: string
}

// One request per cache key at a time: repeat taps (and React StrictMode's
// double-fired dev effects) share the in-flight promise instead of re-calling OpenAI.
const inFlight = new Map<string, Promise<string>>()

/** Contextual gloss for a tapped word. Cached permanently on-device. */
export async function translateWord(req: WordLookup): Promise<string> {
  const key = await cacheKey(['word', req.targetLang, 'en', req.model, req.word, req.sentence])
  const hit = await getCached(key)
  if (hit) return hit.result

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = requestGloss(key, req).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

async function requestGloss(key: string, req: WordLookup): Promise<string> {
  const language = langName(req.targetLang)
  const result = await chatComplete({
    apiKey: req.apiKey,
    model: req.model,
    maxTokens: 120,
    system: `You are a concise bilingual reading assistant helping an English speaker read ${language}.`,
    user: `Sentence: "${req.sentence}"\n\nWhat does "${req.word}" mean in this sentence? Answer with the English meaning only, in at most one short line. If it is an inflected form, add the base form in parentheses.`,
  })

  await putCached({
    key,
    kind: 'word',
    sourceText: req.word,
    context: req.sentence,
    result,
    model: req.model,
    createdAt: Date.now(),
  })
  return result
}
