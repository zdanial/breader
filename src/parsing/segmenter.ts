// Sentence segmentation via Intl.Segmenter (iOS Safari ≥ 16.4).

/**
 * Split raw text into paragraphs: blank-line separated, with hard-wrapped
 * lines inside a paragraph (common in .txt books) joined back together.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function segmentSentences(paragraph: string, lang: string): string[] {
  const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' })
  return [...segmenter.segment(paragraph)]
    .map((s) => s.segment.trim())
    .filter(Boolean)
}
