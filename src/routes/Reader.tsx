import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { SentenceText } from '../reader/SentenceText'
import { useSwipe } from '../reader/useGestures'

export default function Reader({ bookId }: { bookId: string }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const settings = useSettings()
  const [pos, setPos] = useState<number | null>(null)

  // initialize position from the saved resume point once the book loads
  useEffect(() => {
    if (book && pos === null) setPos(book.positionIndex)
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

      <main className="sentence-area" ref={contentRef}>
        {sentence && <SentenceText text={sentence.text} lang={book.targetLang} dir={book.dir} />}
      </main>

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
