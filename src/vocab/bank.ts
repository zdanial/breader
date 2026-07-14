// Shared vocabulary "word bank" (DESIGN.md §11). A per-language knowledge model
// both Read and Learn write to and can read from — the substrate for future
// pre-gloss and create-lesson-from-word-bank features. Kept deliberately simple.
import { db, type VocabEntry } from '../db/schema'

/** Normalize a surface word into a lemma key. v0: lowercase + strip non-letters.
 *  Real lemmatization (stemming, dictionary base forms) is a fast-follow. */
export function normalizeLemma(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const vocabId = (lang: string, lemma: string) => `${lang.toLowerCase().split('-')[0]}:${lemma}`

/** Familiarity from the counts. Simple, tunable rules over seen/correct. */
function deriveStatus(e: Pick<VocabEntry, 'seen' | 'correct' | 'incorrect'>): VocabEntry['status'] {
  if (e.correct >= 3 && e.correct > e.incorrect) return 'known'
  if (e.seen > 0) return 'learning'
  return 'new'
}

export interface Encounter {
  lang: string
  word: string // surface form
  gloss?: string
  source: 'reader' | 'learn' | 'saved'
  correct?: boolean // Learn: whether the answer was right
}

/** Record one encounter with a word, upserting its bank entry. */
export async function recordEncounter(e: Encounter): Promise<void> {
  const lemma = normalizeLemma(e.word)
  if (!lemma) return
  const id = vocabId(e.lang, lemma)
  const now = Date.now()

  await db.transaction('rw', db.vocab, async () => {
    const prev = await db.vocab.get(id)
    const base: VocabEntry = prev ?? {
      id,
      lang: e.lang.toLowerCase().split('-')[0],
      lemma,
      seen: 0,
      correct: 0,
      incorrect: 0,
      status: 'new',
      firstSeenAt: now,
      lastSeenAt: now,
      sources: [],
    }
    base.seen += 1
    base.lastSeenAt = now
    base.surface = e.word
    if (e.gloss) base.gloss = e.gloss
    if (e.correct === true) base.correct += 1
    if (e.correct === false) base.incorrect += 1
    if (!base.sources.includes(e.source)) base.sources.push(e.source)
    base.status = deriveStatus(base)
    await db.vocab.put(base)
  })
}

/** Words the user likely doesn't know yet in a language (for pre-gloss / practice). */
export function weakWords(lang: string, limit = 50): Promise<VocabEntry[]> {
  const primary = lang.toLowerCase().split('-')[0]
  return db.vocab
    .where('[lang+status]')
    .anyOf([
      [primary, 'new'],
      [primary, 'learning'],
    ])
    .reverse()
    .sortBy('lastSeenAt')
    .then((rows) => rows.slice(0, limit))
}
