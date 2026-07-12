import { useMemo } from 'react'

export interface WordToken {
  text: string
  isWord: boolean
}

export function tokenize(text: string, lang: string): WordToken[] {
  const segmenter = new Intl.Segmenter(lang, { granularity: 'word' })
  return [...segmenter.segment(text)].map((s) => ({ text: s.segment, isWord: !!s.isWordLike }))
}

export function SentenceText({
  text,
  lang,
  dir,
  selectedIndex,
  onWordTap,
}: {
  text: string
  lang: string
  dir: 'ltr' | 'rtl'
  selectedIndex?: number | null
  onWordTap?: (word: string, index: number, rect: DOMRect) => void
}) {
  const tokens = useMemo(() => tokenize(text, lang), [text, lang])
  return (
    <p className="sentence" lang={lang} dir={dir}>
      {tokens.map((token, i) =>
        token.isWord ? (
          <span
            key={i}
            className={i === selectedIndex ? 'word selected' : 'word'}
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
