import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  addHighlight,
  findExactHighlight,
  quoteIdFor,
  removeHighlight,
  saveWord,
  toggleQuote,
} from '../db/bank'
import { db } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { translateWord, translatePhrase } from '../translation/wordTranslator'
import { FONT_STACKS } from '../db/settings'
import { ExplainTray } from '../reader/ExplainTray'
import { SelectionPopover } from '../reader/SelectionPopover'
import { SentenceText, sliceTokens, useTokens } from '../reader/SentenceText'
import { useFitText } from '../reader/useFitText'
import { useSwipe } from '../reader/useGestures'
import { useOrientation } from '../reader/useOrientation'
import { useSentenceTranslation } from '../reader/useSentenceTranslation'
import { ProgressBar, Rule } from '../ui'

const pad2 = (n: number) => String(n).padStart(2, '0')

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

  // mark this as the 'currently reading' book (drives the library live square)
  useEffect(() => {
    void updateSettings({ lastReadBookId: bookId })
  }, [bookId])

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

  // scroll is locked unless the sentence genuinely overflows the screen —
  // otherwise swipes rubber-band the view and everything jiggles
  const [overflowing, setOverflowing] = useState(false)

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

  // measure-and-fit: the chosen size is the ceiling; long sentences shrink to fit
  const fitText = peek ? (pair.translation ?? '') : (sentence?.text ?? '')
  // The reading area permanently reserves the collapsed explain-tray zone at
  // the bottom (via CSS padding), so text is always sized above where the tray
  // will appear — the tray slides out without ever shifting the text.
  const fontPx = useFitText(contentRef, {
    text: fitText,
    maxPx: Math.round(46 * settings.fontScale),
    enabled: orientation === 'portrait',
  })

  // scroll only unlocks if the sentence still overflows at the fitted size
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.scrollTop = 0
    setOverflowing(el.scrollHeight > el.clientHeight + 4)
  }, [sentence, orientation, fontPx])

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

  // ── bank: highlights for this sentence + quote-bookmark state ──
  const highlights = useLiveQuery(
    () => (sentence ? db.highlights.where('sentenceId').equals(sentence.id).toArray() : []),
    [sentence],
  )
  const quoteId = useLiveQuery(
    () => (pos == null ? undefined : quoteIdFor(bookId, pos)),
    [bookId, pos],
  )

  const exactHighlight = selection
    ? findExactHighlight(highlights, selection.start, selection.end)
    : undefined

  const handleSaveWord = useCallback(async () => {
    if (!book || !sentence || !selection) return
    const text = sliceTokens(tokens, selection.start, selection.end)
    const lookup = {
      text,
      sentence: sentence.text,
      targetLang: book.targetLang,
      model: settings.model,
      apiKey: settings.openaiKey,
      bookId: book.id,
    }
    // snapshot the translation — instant if the popover already fetched it
    const translation = await (selection.start === selection.end
      ? translateWord(lookup)
      : translatePhrase(lookup)
    ).catch(() => undefined)
    await saveWord({
      text,
      translation,
      sentence: sentence.text,
      targetLang: book.targetLang,
      bookId: book.id,
      bookTitle: book.title,
    })
  }, [book, sentence, selection, tokens, settings.model, settings.openaiKey])

  const handleToggleHighlight = useCallback(async () => {
    if (!book || !sentence || !selection) return
    if (exactHighlight) {
      await removeHighlight(exactHighlight.id)
    } else {
      await addHighlight({
        bookId: book.id,
        sentenceId: sentence.id,
        sentenceIndex: sentence.index,
        start: selection.start,
        end: selection.end,
        text: sliceTokens(tokens, selection.start, selection.end),
      })
    }
  }, [book, sentence, selection, exactHighlight, tokens])

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
        ['--read-align' as string]: settings.readAlign ?? 'center',
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
          className={quoteId ? 'icon-btn bookmarked' : 'icon-btn'}
          aria-label={quoteId ? 'Remove quote from bank' : 'Save sentence as quote'}
          onClick={() => {
            if (sentence) void toggleQuote(book, sentence, settings.model)
          }}
        >
          {quoteId ? '★' : '☆'}
        </button>
        <button
          className="font-btn"
          aria-label="Smaller text"
          onClick={() => updateSettings({ fontScale: Math.max(0.4, +(scale - 0.1).toFixed(2)) })}
        >
          A−
        </button>
        <button
          className="font-btn"
          aria-label="Larger text"
          onClick={() => updateSettings({ fontScale: Math.min(1.8, +(scale + 0.1).toFixed(2)) })}
        >
          A+
        </button>
      </header>

      {orientation === 'portrait' ? (
        <main
          className={overflowing ? 'sentence-area scrollable' : 'sentence-area'}
          ref={contentRef}
          onClick={onBackgroundTap}
          {...holdHandlers}
        >
          {sentence &&
            (peek ? (
              <p
                className="sentence base-sentence peeking"
                lang="en"
                dir="ltr"
                style={{ fontSize: fontPx }}
              >
                {pair.translation ?? 'Translating…'}
              </p>
            ) : (
              <SentenceText
                tokens={tokens}
                lang={book.targetLang}
                dir={book.dir}
                fontPx={fontPx}
                selectedRange={selection}
                highlightRanges={highlights}
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
                highlightRanges={highlights}
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
          <div className="sheet toc" onClick={(e) => e.stopPropagation()}>
            <h2 className="sheet-title">chapters</h2>
            <Rule />
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
            term={selectionText}
            lookup={{
              text: selectionText,
              sentence: sentence.text,
              targetLang: book.targetLang,
              model: settings.model,
              apiKey: settings.openaiKey,
              bookId: book.id,
            }}
            isHighlighted={!!exactHighlight}
            onSaveWord={handleSaveWord}
            onToggleHighlight={handleToggleHighlight}
          />
        </>
      )}

      <footer className="reader-footer">
        <div className="reader-foot-row">
          <span style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="page-numeral">{pos != null ? pad2(pos + 1) : '––'}</span>
            <span className="page-total">/ {pad2(count)}</span>
          </span>
          <span className="reader-nav">
            <button onClick={prev} style={{ opacity: pos && pos > 0 ? 1 : 0.28 }} aria-label="Previous">
              ‹
            </button>
            <button
              onClick={next}
              style={{ opacity: pos != null && pos < count - 1 ? 1 : 0.28 }}
              aria-label="Next"
            >
              ›
            </button>
          </span>
        </div>
        <ProgressBar value={count > 1 && pos != null ? pos / (count - 1) : 0} />
      </footer>
    </div>
  )
}
