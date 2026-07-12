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
  selectedRange,
  onWordTap,
}: {
  tokens: WordToken[]
  lang: string
  dir: 'ltr' | 'rtl'
  selectedRange?: { start: number; end: number } | null
  onWordTap?: (word: string, index: number, rect: DOMRect) => void
}) {
  const range = selectedRange
  return (
    <p className="sentence" lang={lang} dir={dir}>
      {tokens.map((token, i) =>
        token.isWord ? (
          <span
            key={i}
            className={
              range && i >= range.start && i <= range.end ? 'word selected' : 'word'
            }
            onClick={
              onWordTap
                ? (e) => onWordTap(token.text, i, e.currentTarget.getBoundingClientRect())
                : undefined
            }
          >
            {token.text}
          </span>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </p>
  )
}

/** Convenience for callers that don't need token access. */
export function useTokens(text: string | undefined, lang: string): WordToken[] {
  return useMemo(() => (text ? tokenize(text, lang) : []), [text, lang])
}
