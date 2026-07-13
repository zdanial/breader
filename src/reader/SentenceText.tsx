import { useMemo } from 'react'

export interface WordToken {
  text: string
  isWord: boolean
}

export function tokenize(text: string, lang: string): WordToken[] {
  const segmenter = new Intl.Segmenter(lang, { granularity: 'word' })
  return [...segmenter.segment(text)].map((s) => ({ text: s.segment, isWord: !!s.isWordLike }))
}

/** The original text of tokens[start..end], punctuation and spacing intact. */
export function sliceTokens(tokens: WordToken[], start: number, end: number): string {
  return tokens
    .slice(start, end + 1)
    .map((t) => t.text)
    .join('')
    .trim()
}

export function SentenceText({
  tokens,
  lang,
  dir,
  fontPx,
  selectedRange,
  highlightRanges,
  onWordTap,
}: {
  tokens: WordToken[]
  lang: string
  dir: 'ltr' | 'rtl'
  fontPx?: number
  selectedRange?: { start: number; end: number } | null
  highlightRanges?: Array<{ start: number; end: number }>
  onWordTap?: (word: string, index: number, rect: DOMRect) => void
}) {
  const range = selectedRange
  const isHighlighted = (i: number) =>
    highlightRanges?.some((h) => i >= h.start && i <= h.end) ?? false
  return (
    <p className="sentence" lang={lang} dir={dir} style={fontPx ? { fontSize: fontPx } : undefined}>
      {tokens.map((token, i) =>
        token.isWord ? (
          <span
            key={i}
            className={[
              'word',
              isHighlighted(i) ? 'hl' : '',
              range && i >= range.start && i <= range.end ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={
              onWordTap
                ? (e) => onWordTap(token.text, i, e.currentTarget.getBoundingClientRect())
                : undefined
            }
          >
            {token.text}
          </span>
        ) : (
          <span key={i} className={isHighlighted(i) && isHighlighted(i + 1) ? 'hl' : undefined}>
            {token.text}
          </span>
        ),
      )}
    </p>
  )
}

/** Convenience for callers that don't need token access. */
export function useTokens(text: string | undefined, lang: string): WordToken[] {
  return useMemo(() => (text ? tokenize(text, lang) : []), [text, lang])
}
