import { useCallback, useEffect, useRef, useState } from 'react'
import { GlossChip } from '../learn/GlossChip'
import type { GlossSource } from '../learn/gloss'
import { SpeakerButton } from '../tts/SpeakerButton'
import { useSpeak } from '../tts/useSpeak'
import { ProgressBar } from '../ui'
import { SentenceText, useTokens } from './SentenceText'
import { useFitText } from './useFitText'
import { useSwipe } from './useGestures'

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Sentence-at-a-time reading view — the reader experience for an arbitrary
 * passage: autosize, swipe/nav, tap a word for a gloss, HOLD to peek the base
 * translation, speaker audio. Reusable (used by the Learn `read` lesson now).
 *
 * TODO(unify-reader): migrate the book Reader (src/routes/Reader.tsx) onto this
 * shared component so there is one reading implementation, not two.
 */
export function PassageReader({
  sentences,
  translations,
  dir,
  lang,
  glossSrc,
  onDone,
}: {
  sentences: string[]
  translations?: string[]
  dir: 'ltr' | 'rtl'
  lang: string
  glossSrc: GlossSource
  onDone: () => void
}) {
  const [pos, setPos] = useState(0)
  const [peek, setPeek] = useState(false)
  const [gloss, setGloss] = useState<{ word: string; rect: DOMRect } | null>(null)
  const { say, hasKey } = useSpeak()
  const contentRef = useRef<HTMLElement | null>(null)
  const suppressTap = useRef(false)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = sentences.length
  const sentence = sentences[pos] ?? ''
  const base = translations?.[pos]
  const tokens = useTokens(sentence, lang)

  const next = useCallback(() => {
    setGloss(null)
    setPos((p) => {
      if (p + 1 >= total) {
        onDone()
        return p
      }
      return p + 1
    })
  }, [total, onDone])
  const prev = useCallback(() => {
    setGloss(null)
    setPos((p) => Math.max(0, p - 1))
  }, [])
  const swipe = useSwipe({ onNext: next, onPrev: prev, scrollRef: contentRef })

  const fontPx = useFitText(contentRef, { text: peek ? (base ?? '') : sentence, maxPx: 44 })

  const endPeek = useCallback(() => {
    if (peekTimer.current) clearTimeout(peekTimer.current)
    peekTimer.current = null
    holdStart.current = null
    setPeek(false)
  }, [])
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      holdStart.current = { x: e.clientX, y: e.clientY }
      peekTimer.current = setTimeout(() => {
        suppressTap.current = true
        setPeek(true)
      }, 400)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = holdStart.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12 && !peek) endPeek()
    },
    onPointerUp: () => {
      endPeek()
      setTimeout(() => (suppressTap.current = false), 80)
    },
    onPointerCancel: endPeek,
    onPointerLeave: endPeek,
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [next, prev])

  return (
    <div className="passage-reader">
      <div className="passage-top">
        {hasKey && <SpeakerButton onClick={() => say(sentence)} label="Play sentence" />}
      </div>
      <main
        className="sentence-area passage-area"
        ref={contentRef}
        onClick={(e) => {
          if (!suppressTap.current && !(e.target as HTMLElement).closest('.word')) setGloss(null)
        }}
        {...swipe}
        {...hold}
      >
        {peek ? (
          <p className="sentence base-sentence peeking" lang="en" dir="ltr">
            {base ?? '—'}
          </p>
        ) : (
          <SentenceText
            tokens={tokens}
            lang={lang}
            dir={dir}
            fontPx={fontPx}
            onWordTap={(word, _i, rect) => {
              if (!suppressTap.current) setGloss({ word, rect })
            }}
          />
        )}
      </main>
      <footer className="reader-footer">
        <div className="reader-foot-row">
          <span style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="page-numeral">{pad2(pos + 1)}</span>
            <span className="page-total">/ {pad2(total)}</span>
          </span>
          <span className="reader-nav">
            <button onClick={prev} style={{ opacity: pos > 0 ? 1 : 0.28 }} aria-label="Previous">
              ‹
            </button>
            <button onClick={next} aria-label="Next">
              ›
            </button>
          </span>
        </div>
        <ProgressBar value={total > 1 ? pos / (total - 1) : 0} />
        <p className="passage-hint muted">hold to see the translation</p>
      </footer>
      {gloss && (
        <GlossChip word={gloss.word} anchor={gloss.rect} src={glossSrc} onClose={() => setGloss(null)} />
      )}
    </div>
  )
}
