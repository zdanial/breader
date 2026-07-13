import { defaultSegmenter } from './default'
import { germanSegmenter } from './de'
import type { LanguageSegmenter } from './types'

// Language-specific segmenters. RTL (ar/he) are added in Phase 3.
const segmenters: LanguageSegmenter[] = [germanSegmenter]

/** The segmenter for a language, or the fragment-merging default. */
export function pickSegmenter(lang: string): LanguageSegmenter {
  const primary = lang.toLowerCase().split('-')[0]
  return segmenters.find((s) => s.langs.includes(primary)) ?? defaultSegmenter
}

/** Convenience: segment a paragraph using the right segmenter for `lang`. */
export function segmentParagraph(paragraph: string, lang: string): string[] {
  return pickSegmenter(lang).segment(paragraph, lang)
}
