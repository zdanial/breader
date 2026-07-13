import type { LanguageSegmenter } from './types'
import { mergeFragments } from './merge'

/**
 * Default segmenter for any language: Intl.Segmenter (sentence granularity)
 * plus fragment-merge repair. Used when no language-specific segmenter matches.
 */
export const defaultSegmenter: LanguageSegmenter = {
  langs: [],
  segment(paragraph, lang) {
    const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' })
    const raw = [...segmenter.segment(paragraph)].map((s) => s.segment)
    return mergeFragments(raw)
  },
}
