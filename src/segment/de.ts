import type { LanguageSegmenter } from './types'
import { mergeFragments } from './merge'

// German dialogue uses guillemets »…« (and „…"), which Intl.Segmenter often
// splits from their speech tag ("»Nach Hause«, sagte er."). We rejoin a segment
// to the previous one when the previous ends inside/at a closing quote and this
// one is a short continuation — on top of the shared fragment merge.
const CLOSE_QUOTE = /[«»”"]\s*[,;:]?\s*$/

export const germanSegmenter: LanguageSegmenter = {
  langs: ['de'],
  segment(paragraph, lang) {
    const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' })
    const raw = [...segmenter.segment(paragraph)].map((s) => s.segment)
    const merged = mergeFragments(raw)

    // rejoin dangling closing-quote fragments with their following clause
    const out: string[] = []
    for (const seg of merged) {
      const prev = out[out.length - 1]
      if (prev && CLOSE_QUOTE.test(prev) && /^[a-zà-öø-ÿß]/u.test(seg)) {
        out[out.length - 1] = `${prev} ${seg}`.replace(/\s+/g, ' ').trim()
      } else {
        out.push(seg)
      }
    }
    return out
  },
}
