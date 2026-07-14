// Shared vocabulary "word bank" (DESIGN.md §11). A per-language knowledge model
// both Read and Learn write to and read from. It is the single source of truth
// for words (single saved words live here too) and powers the local review
// engine via an Anki-style SM-2 scheduler that is graded automatically from
// outcomes — there are no rating buttons.
import Dexie from 'dexie'
import { db, type VocabEntry, type VocabOrigin } from '../db/schema'

const DAY = 86_400_000

/** SM-2 grade. Derived from outcomes, never chosen by the user. */
export type Grade = 0 | 1 | 2 | 3 // Again | Hard | Good | Easy

/** Normalize a surface word into a lemma key. v1: lowercase + strip non-letters.
 *  Real lemmatization (a forms/root connector) is deferred — DESIGN.md §11.1. */
export function normalizeLemma(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const prim = (l: string) => (l ?? '').toLowerCase().split('-')[0]
const vocabId = (lang: string, lemma: string) => `${prim(lang)}:${lemma}`

function newEntry(id: string, lang: string, lemma: string, now: number): VocabEntry {
  return {
    id, lang: prim(lang), lemma,
    tracked: false, ease: 2.5, intervalDays: 0, reps: 0, lapses: 0,
    seen: 0, correct: 0, incorrect: 0, lookups: 0,
    firstSeenAt: now, lastSeenAt: now, sources: [],
  }
}

/** Familiarity derived from the scheduler state (not stored). */
export function deriveStatus(e: Pick<VocabEntry, 'tracked' | 'reps' | 'intervalDays' | 'seen'>): 'new' | 'learning' | 'known' {
  if (e.tracked && e.reps >= 2 && e.intervalDays >= 7) return 'known'
  if (e.tracked && (e.reps >= 1 || e.intervalDays > 0)) return 'learning'
  return e.seen > 0 ? 'learning' : 'new'
}

/** Apply an SM-2 grade in place — advances/collapses the interval and due date. */
function applyGrade(v: VocabEntry, grade: Grade, now: number): void {
  v.tracked = true
  v.lastGrade = grade
  v.lastReviewedAt = now
  if (grade === 0) {
    // Again — lapse: reset reps, collapse interval, ease penalty, due now
    v.reps = 0
    v.lapses += 1
    v.intervalDays = 0
    v.ease = Math.max(1.3, v.ease - 0.2)
  } else {
    if (grade === 1) {
      // Hard — small growth, ease penalty
      v.intervalDays = v.intervalDays > 0 ? v.intervalDays * 1.2 : 1
      v.ease = Math.max(1.3, v.ease - 0.15)
    } else {
      // Good / Easy — grow by ease
      v.intervalDays = v.intervalDays > 0 ? v.intervalDays * v.ease : 1
      if (grade === 3) v.ease += 0.1
    }
    v.reps += 1
  }
  v.intervalDays = Math.round(v.intervalDays * 100) / 100
  v.dueAt = now + Math.max(0, v.intervalDays) * DAY
}

// ── writes ───────────────────────────────────────────────────────────────────

export interface Encounter {
  lang: string
  word: string // surface form
  gloss?: string
  source: 'reader' | 'learn' | 'saved'
  origin?: VocabOrigin
  lookup?: boolean // reader look-up — counts toward the >= 2 promotion threshold
}

/** Log one encounter (exposure). Two-tier: always logs; promotes to a scheduled
 *  card only on intent (a learn/saved source, or a 2nd reader look-up). */
export async function recordEncounter(e: Encounter): Promise<void> {
  const lemma = normalizeLemma(e.word)
  if (!lemma) return
  const id = vocabId(e.lang, lemma)
  const now = Date.now()
  await db.transaction('rw', db.vocab, async () => {
    const prev = await db.vocab.get(id)
    const v = prev ?? newEntry(id, e.lang, lemma, now)
    v.seen += 1
    v.lastSeenAt = now
    v.surface = e.word
    if (e.gloss) v.gloss = e.gloss
    if (e.lookup) v.lookups += 1
    if (!v.sources.includes(e.source)) v.sources.push(e.source)
    if (!v.origin && e.origin) v.origin = e.origin
    // promote on intent: taught/tested in Learn, explicitly saved, or looked up twice
    if (!v.tracked && (e.source === 'learn' || e.source === 'saved' || v.lookups >= 2)) {
      v.tracked = true
      if (v.dueAt == null) { v.intervalDays = 0; v.dueAt = now }
    }
    await db.vocab.put(v)
  })
}

/** Record a graded Learn result (or a review answer): logs exposure and advances
 *  the SM-2 schedule. Always tracks the word. */
export async function recordResult(p: {
  lang: string
  word: string
  gloss?: string
  grade: Grade
  origin?: VocabOrigin
}): Promise<void> {
  const lemma = normalizeLemma(p.word)
  if (!lemma) return
  const id = vocabId(p.lang, lemma)
  const now = Date.now()
  await db.transaction('rw', db.vocab, async () => {
    const prev = await db.vocab.get(id)
    const v = prev ?? newEntry(id, p.lang, lemma, now)
    v.seen += 1
    v.lastSeenAt = now
    v.surface = p.word
    if (p.gloss) v.gloss = p.gloss
    if (!v.sources.includes('learn')) v.sources.push('learn')
    if (!v.origin && p.origin) v.origin = p.origin
    if (p.grade === 0) v.incorrect += 1
    else v.correct += 1
    applyGrade(v, p.grade, now)
    await db.vocab.put(v)
  })
}

/** Explicit reader "save to word bank" for a single word — enrolls as tracked. */
export function saveWordToBank(p: { lang: string; word: string; gloss?: string; origin?: VocabOrigin }): Promise<void> {
  return recordEncounter({ lang: p.lang, word: p.word, gloss: p.gloss, source: 'saved', origin: p.origin })
}

/** Map a Learn exercise outcome to an SM-2 grade. */
export function learnGrade(correct: boolean, wasRequeued: boolean): Grade {
  if (!correct) return 0 // Again
  return wasRequeued ? 1 : 2 // Hard after a miss, else Good
}

export const deleteVocab = (id: string) => db.vocab.delete(id)

// ── reads ────────────────────────────────────────────────────────────────────

/** All tracked (scheduled) entries in a language. */
export function trackedWords(lang: string): Promise<VocabEntry[]> {
  const l = prim(lang)
  return db.vocab.where('[lang+dueAt]').between([l, Dexie.minKey], [l, Dexie.maxKey]).toArray()
}

/** Tracked entries due for review now (soonest-due first). */
export async function dueWords(lang: string, opts?: { now?: number; limit?: number }): Promise<VocabEntry[]> {
  const now = opts?.now ?? Date.now()
  const l = prim(lang)
  const rows = await db.vocab.where('[lang+dueAt]').between([l, Dexie.minKey], [l, now], true, true).toArray()
  rows.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  return opts?.limit ? rows.slice(0, opts.limit) : rows
}

/** A usable single-word bank entry: has a gloss and isn't a stray phrase. */
export const isWordEntry = (v: VocabEntry) => !!v.gloss && !/\s/.test((v.surface ?? v.lemma).trim())

/** Words the user knows / is learning (for generator recycling + review pool). */
export async function knownWords(lang: string, limit = 300): Promise<VocabEntry[]> {
  const all = await trackedWords(lang)
  return all
    .filter((v) => deriveStatus(v) !== 'new' && isWordEntry(v))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
    .slice(0, limit)
}
