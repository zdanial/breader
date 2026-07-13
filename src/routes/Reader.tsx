import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { FONT_STACKS } from '../db/settings'
import { ExplainTray } from '../reader/ExplainTray'
import { SelectionPopover } from '../reader/SelectionPopover'
import { SentenceText, sliceTokens, useTokens } from '../reader/SentenceText'
import { useSwipe } from '../reader/useGestures'
import { useOrientation } from '../reader/useOrientation'
import { useSentenceTranslation } from '../reader/useSentenceTranslation'

interface Selection {
  start: number // token indices, inclusive
  end: number
  rect: DOMRect
}

export default function Reader({ bookId }: { bookId: string }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const settings = useSettings()
  const [pos, setPos] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [showToc, setShowToc] = useState(false)

  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('index'),
    [bookId],
  )

  // moving to another sentence dismisses any open gloss
  useEffect(() => setSelection(null), [pos])

  // initialize position from the saved resume point once the book loads,
  // clamped in case a stale/corrupt value was persisted
  useEffect(() => {
    if (book && pos === null) {
      setPos(Math.min(Math.max(0, book.positionIndex), book.sentenceCount - 1))
    }
  }, [book, pos])

  const sentence = useLiveQuery(
    () => (pos == null ? undefined : db.sentences.get(`${bookId}:${pos}`)),
    [bookId, pos],
  )

  // persist position (debounced) so reopening resumes here
  useEffect(() => {
    if (pos == null) return
    const t = setTimeout(() => void db.books.update(bookId, { positionIndex: pos }), 400)
    return () => clearTimeout(t)
  }, [bookId, pos])

  const count = book?.sentenceCount ?? 0
  const next = useCallback(
    () => setPos((p) => (p == null ? p : Math.min(p + 1, count - 1))),
    [count],
  )
  const prev = useCallback(() => setPos((p) => (p == null ? p : Math.max(p - 1, 0))), [])

  const contentRef = useRef<HTMLElement | null>(null)
  const swipe = useSwipe({ onNext: next, onPrev: prev, scrollRef: contentRef })

  const orientation = useOrientation()

  // hold-to-peek: press and hold in portrait shows the English of this sentence
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  const suppressTap = useRef(false)

  const endPeek = useCallback(() => {
    if (peekTimer.current) clearTimeout(peekTimer.current)
    peekTimer.current = null
    holdStart.current = null
    setPeek(false)
  }, [])

  const holdHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      holdStart.current = { x: e.clientX, y: e.clientY }
      peekTimer.current = setTimeout(() => {
        suppressTap.current = true // the release must not count as a word tap
        setPeek(true)
      }, 400)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = holdStart.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12 && !peek) endPeek()
    },
    onPointerUp: () => {
      endPeek()
      // let the synthetic click that follows this release be ignored, then re-arm
      setTimeout(() => (suppressTap.current = false), 80)
    },
    onPointerCancel: endPeek,
    onPointerLeave: endPeek,
  }

  const pair = useSentenceTranslation(
    book,
    sentence,
    settings,
    orientation === 'landscape' || peek,
  )

  const tokens = useTokens(sentence?.text, book?.targetLang ?? 'en')

  // tap 1 = word · tap on a second word = span between them · re-tap = dismiss
  const onWordTap = useCallback((_word: string, index: number, rect: DOMRect) => {
    if (suppressTap.current) return // release of a hold-to-peek, not a real tap
    setSelection((sel) => {
      if (!sel) return { start: index, end: index, rect }
      if (sel.start === sel.end) {
        if (index === sel.start) return null
        return { start: Math.min(sel.start, index), end: Math.max(sel.start, index), rect }
      }
      return { start: index, end: index, rect }
    })
  }, [])

  // tapping anything that isn't a word dismisses the selection
  const onBackgroundTap = useCallback((e: React.MouseEvent) => {
    if (suppressTap.current) return
    if (!(e.target as HTMLElement).closest('.word')) setSelection(null)
  }, [])

  const selectionText = selection ? sliceTokens(tokens, selection.start, selection.end) : ''

  // keyboard navigation for desktop testing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') next()
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev])

  if (book === undefined) return <div className="page center" />
  if (book === null || !book) {
    return (
      <div className="page center">
        <p className="muted">
          Book not found. <a href="#/">Back to library</a>
        </p>
      </div>
    )
  }

  const scale = settings.fontScale
  return (
    <div
      className="page reader"
      style={{
        ['--font-scale' as string]: scale,
        ['--font-reading' as string]: FONT_STACKS[settings.fontFamily] ?? FONT_STACKS.serif,
      }}
      {...swipe}
    >
      <header className="topbar">
        <a className="icon-btn" href="#/" aria-label="Back to library">
          ‹
        </a>
        {chapters && chapters.length > 1 ? (
          <button className="reader-title as-button" onClick={() => setShowToc(true)}>
            {book.title} ▾
          </button>
        ) : (
          <span className="reader-title">{book.title}</span>
        )}
        <button
          className="icon-btn"
          aria-label="Smaller text"
          onClick={() => updateSettings({ fontScale: Math.max(0.7, +(scale - 0.1).toFixed(2)) })}
        >
          A−
        </button>
        <button
          className="icon-btn"
          aria-label="Larger text"
          onClick={() => updateSettings({ fontScale: Math.min(1.8, +(scale + 0.1).toFixed(2)) })}
        >
          A+
        </button>
      </header>

      {orientation === 'portrait' ? (
        <main
          className="sentence-area"
          ref={contentRef}
          onClick={onBackgroundTap}
          {...holdHandlers}
        >
          {sentence &&
            (peek ? (
              <p className="sentence base-sentence peeking" lang="en" dir="ltr">
                {pair.translation ?? 'Translating…'}
              </p>
            ) : (
              <SentenceText
                tokens={tokens}
                lang={book.targetLang}
                dir={book.dir}
                selectedRange={selection}
                onWordTap={onWordTap}
              />
            ))}
        </main>
      ) : (
        <main className="pair-area" ref={contentRef} onClick={onBackgroundTap}>
          <div className="pane">
            {sentence && (
              <SentenceText
                tokens={tokens}
                lang={book.targetLang}
                dir={book.dir}
                selectedRange={selection}
                onWordTap={onWordTap}
              />
            )}
          </div>
          <div className="pane" dir="ltr">
            {pair.translation ? (
              <p className="sentence base-sentence" lang="en">
                {pair.translation}
              </p>
            ) : pair.error ? (
              <div className="pane-status">
                {pair.error === 'no-key' ? (
                  <>
                    <span className="muted">Add your OpenAI key to translate.</span>
                    <a className="btn" href="#/settings">
                      Open Settings
                    </a>
                  </>
                ) : pair.error === 'quota' ? (
                  <span className="muted">Your OpenAI account is out of credits.</span>
                ) : (
                  <>
                    <span className="muted">
                      {pair.error === 'offline' ? 'You’re offline.' : 'Translation failed.'}
                    </span>
                    <button className="btn" onClick={pair.retry}>
                      Retry
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className="sentence base-sentence muted">Translating…</p>
            )}
          </div>
        </main>
      )}

      {showToc && chapters && (
        <div className="modal-overlay" onClick={() => setShowToc(false)}>
          <div className="modal toc" onClick={(e) => e.stopPropagation()}>
            <h2>Chapters</h2>
            <div className="toc-list">
              {chapters.map((ch) => {
                const isCurrent =
                  pos != null &&
                  pos >= ch.startSentenceIndex &&
                  (chapters[ch.index + 1] === undefined ||
                    pos < chapters[ch.index + 1].startSentenceIndex)
                return (
                  <button
                    key={ch.index}
                    className={isCurrent ? 'toc-item current' : 'toc-item'}
                    onClick={() => {
                      setPos(ch.startSentenceIndex)
                      setShowToc(false)
                    }}
                  >
                    {ch.title}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {selection && sentence && selectionText && !peek && (
        <>
          <SelectionPopover
            lookup={{
              text: selectionText,
              sentence: sentence.text,
              targetLang: book.targetLang,
              model: settings.model,
              apiKey: settings.openaiKey,
              bookId: book.id,
            }}
            kind={selection.start === selection.end ? 'word' : 'phrase'}
            anchor={selection.rect}
          />
          <ExplainTray
            key={selectionText}
            lookup={{
              text: selectionText,
              sentence: sentence.text,
              targetLang: book.targetLang,
              model: settings.model,
              apiKey: settings.openaiKey,
              bookId: book.id,
            }}
          />
        </>
      )}

      <footer className="reader-footer">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="reader-progress">
            {pos != null ? pos + 1 : '–'} / {count}
          </span>
        </div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${count > 1 && pos != null ? (pos / (count - 1)) * 100 : 0}%` }}
          />
        </div>
      </footer>
    </div>
  )
}
