import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { SelectionPopover } from '../reader/SelectionPopover'
import { SentenceText } from '../reader/SentenceText'
import { useSwipe } from '../reader/useGestures'
import { useOrientation } from '../reader/useOrientation'
import { useSentenceTranslation } from '../reader/useSentenceTranslation'

interface Selection {
  word: string
  index: number
  rect: DOMRect
}

export default function Reader({ bookId }: { bookId: string }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const settings = useSettings()
  const [pos, setPos] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

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
  const pair = useSentenceTranslation(book, sentence, settings, orientation === 'landscape')

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
      style={{ ['--font-scale' as string]: scale }}
      {...swipe}
    >
      <header className="topbar">
        <a className="icon-btn" href="#/" aria-label="Back to library">
          ‹
        </a>
        <span className="reader-title">{book.title}</span>
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
        <main className="sentence-area" ref={contentRef}>
          {sentence && (
            <SentenceText
              text={sentence.text}
              lang={book.targetLang}
              dir={book.dir}
              selectedIndex={selection?.index}
              onWordTap={(word, index, rect) =>
                setSelection((sel) => (sel?.index === index ? null : { word, index, rect }))
              }
            />
          )}
        </main>
      ) : (
        <main className="pair-area" ref={contentRef}>
          <div className="pane">
            {sentence && (
              <SentenceText
                text={sentence.text}
                lang={book.targetLang}
                dir={book.dir}
                selectedIndex={selection?.index}
                onWordTap={(word, index, rect) =>
                  setSelection((sel) => (sel?.index === index ? null : { word, index, rect }))
                }
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

      {selection && sentence && (
        <SelectionPopover
          word={selection.word}
          sentence={sentence.text}
          targetLang={book.targetLang}
          model={settings.model}
          apiKey={settings.openaiKey}
          anchor={selection.rect}
          onClose={() => setSelection(null)}
        />
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
