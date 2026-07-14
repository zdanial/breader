// Lesson word gloss: glossary-first (offline), LLM fallback if a key is set.
// Feeds the shared word bank. Reuses the reader's translateWord.
import { translateWord } from '../translation/wordTranslator'
import { normalizeLemma, recordEncounter } from '../vocab/bank'

export interface GlossSource {
  glossary?: Array<{ word: string; gloss: string; note?: string }>
  lang: string
  model: string
  apiKey?: string
}

/** Resolve a word's gloss. Returns null when offline with no glossary hit. */
export async function resolveGloss(
  word: string,
  src: GlossSource,
): Promise<{ gloss: string; note?: string } | null> {
  const norm = normalizeLemma(word)
  if (!norm) return null
  const hit = src.glossary?.find((g) => normalizeLemma(g.word) === norm)
  if (hit) {
    void recordEncounter({ lang: src.lang, word, gloss: hit.gloss, source: 'learn' })
    return { gloss: hit.gloss, note: hit.note }
  }
  if (src.apiKey) {
    const gloss = await translateWord({
      text: word,
      sentence: word,
      targetLang: src.lang,
      model: src.model,
      apiKey: src.apiKey,
    })
    void recordEncounter({ lang: src.lang, word, gloss, source: 'learn' })
    return { gloss }
  }
  return null
}
