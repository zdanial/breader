// Local review engine (DESIGN.md §11). Assembles a review session on the fly
// from due/weak word-bank entries + their glosses — no LLM, no stored lesson,
// always "no new words." Runs through the shared LessonPlayer; grades feed the
// SM-2 scheduler. LLM sentence-context review is a later, optional layer.
import type { LessonItem, VocabEntry } from '../db/schema'
import { dueWords, trackedWords } from './bank'

const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'yi', 'dv'])
const prim = (l: string) => (l ?? '').toLowerCase().split('-')[0]
export const dirFor = (lang: string): 'ltr' | 'rtl' => (RTL.has(prim(lang)) ? 'rtl' : 'ltr')

export interface ReviewScope {
  courseId?: string
  unitId?: string
}

export interface ReviewSession {
  lang: string
  dir: 'ltr' | 'rtl'
  items: LessonItem[]
  // the vocab word each item reviews (by item index); undefined for match items
  // (MatchView records each pair itself)
  reviewWords: Array<string | undefined>
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const inScope = (v: VocabEntry, s?: ReviewScope) =>
  !s || ((!s.courseId || v.origin?.courseId === s.courseId) && (!s.unitId || v.origin?.unitId === s.unitId))

const glossed = (v: VocabEntry) => !!v.gloss && !!(v.surface ?? v.lemma)

/** How many words are due for review now (for the Learn-home badge). */
export async function reviewDueCount(lang: string, scope?: ReviewScope): Promise<number> {
  const due = await dueWords(lang)
  return due.filter((v) => glossed(v) && inScope(v, scope)).length
}

/**
 * Build a review session. Pulls due words first (honest SM-2 grading via
 * `choice`), pads toward `size` with the most-overdue tracked words, and — for
 * variety — leads with one `match` block drawn only from already-known words so
 * their easy "Good" grades don't distort weak-word scheduling.
 */
export async function buildReviewSession(
  lang: string,
  opts?: { scope?: ReviewScope; size?: number },
): Promise<ReviewSession | null> {
  const size = opts?.size ?? 12
  const scope = opts?.scope
  const now = Date.now()

  const tracked = (await trackedWords(lang)).filter((v) => glossed(v) && inScope(v, scope))
  if (tracked.length === 0) return null

  const due = tracked.filter((v) => (v.dueAt ?? Infinity) <= now).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  // review set: due words first, then pad with the most-overdue remaining
  const picked = due.slice(0, size)
  if (picked.length < size) {
    const rest = tracked
      .filter((v) => !picked.includes(v))
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    picked.push(...rest.slice(0, size - picked.length))
  }
  if (picked.length === 0) return null

  const surfaceOf = (v: VocabEntry) => v.surface ?? v.lemma
  const allWords = tracked.map(surfaceOf)

  const items: LessonItem[] = []
  const reviewWords: Array<string | undefined> = []

  // optional match warmup from known (not-in-review) words
  const known = tracked
    .filter((v) => (v.reps ?? 0) >= 2 && (v.intervalDays ?? 0) >= 7 && !picked.includes(v))
  if (known.length >= 3) {
    const pairWords = shuffle(known).slice(0, Math.min(5, known.length))
    items.push({
      type: 'match',
      pairs: pairWords.map((v) => [surfaceOf(v), v.gloss!] as [string, string]),
    })
    reviewWords.push(undefined)
  }

  // one recognition `choice` per review word: given the meaning, pick the word
  for (const v of picked) {
    const answer = surfaceOf(v)
    const distractors = shuffle(allWords.filter((w) => w.toLowerCase() !== answer.toLowerCase())).slice(0, 3)
    const choices = shuffle([answer, ...distractors])
    items.push({
      type: 'choice',
      prompt: `pick the word for “${v.gloss}”`,
      choices,
      answer: choices.indexOf(answer),
      note: v.gloss,
    })
    reviewWords.push(answer)
  }

  return { lang: prim(lang), dir: dirFor(lang), items, reviewWords }
}
