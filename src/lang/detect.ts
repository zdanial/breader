// Lightweight stopword-based language detection over a text sample.
// Good enough to prefill the import dialog; the user always confirms.

const STOPWORDS: Record<string, string[]> = {
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'von', 'mit', 'sich', 'dem', 'auch'],
  fr: ['le', 'la', 'les', 'et', 'est', 'une', 'des', 'dans', 'que', 'pour', 'pas', 'au', 'ce', 'il'],
  es: ['el', 'la', 'los', 'las', 'es', 'en', 'que', 'de', 'un', 'una', 'por', 'con', 'no', 'se'],
  it: ['il', 'la', 'le', 'che', 'di', 'un', 'una', 'per', 'non', 'si', 'con', 'del', 'della', 'sono'],
  pt: ['os', 'as', 'é', 'de', 'que', 'um', 'uma', 'para', 'não', 'com', 'se', 'do', 'da', 'em'],
  en: ['the', 'and', 'is', 'of', 'to', 'in', 'that', 'it', 'was', 'for', 'with', 'as', 'his', 'this'],
}

/** Detect the dominant language of a sample, or undefined when too ambiguous. */
export function detectLanguage(sample: string): string | undefined {
  const words = sample.toLowerCase().split(/[^\p{L}]+/u, 4000).filter(Boolean)
  if (words.length < 20) return undefined

  const counts = new Map<string, number>()
  for (const [lang, stops] of Object.entries(STOPWORDS)) {
    const set = new Set(stops)
    counts.set(
      lang,
      words.reduce((n, w) => (set.has(w) ? n + 1 : n), 0),
    )
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [bestLang, bestScore] = ranked[0]
  // require a real signal and a clear margin over the runner-up
  if (bestScore < words.length * 0.02 || bestScore < ranked[1][1] * 1.3) return undefined
  return bestLang
}
