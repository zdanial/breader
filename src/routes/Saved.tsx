import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { deleteSavedQuote, deleteSavedWord, removeHighlight } from '../db/bank'
import { db } from '../db/schema'
import { navigate } from '../router'

type Tab = 'words' | 'quotes' | 'highlights'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

/** Jump back into the reader at the exact sentence (if the book still exists). */
async function jumpTo(bookId: string | undefined, sentenceIndex: number) {
  if (!bookId) return
  const book = await db.books.get(bookId)
  if (!book) return
  await db.books.update(bookId, {
    positionIndex: Math.min(sentenceIndex, book.sentenceCount - 1),
  })
  navigate(`/book/${bookId}`)
}

export default function Saved() {
  const [tab, setTab] = useState<Tab>('words')
  const words = useLiveQuery(() => db.savedWords.orderBy('createdAt').reverse().toArray(), [])
  const quotes = useLiveQuery(() => db.savedQuotes.orderBy('createdAt').reverse().toArray(), [])
  const highlights = useLiveQuery(
    () => db.highlights.orderBy('id').toArray().then((h) => h.sort((a, b) => b.createdAt - a.createdAt)),
    [],
  )
  const books = useLiveQuery(() => db.books.toArray(), [])
  const bookTitle = (id: string) => books?.find((b) => b.id === id)?.title ?? 'Deleted book'

  const counts: Record<Tab, number | undefined> = {
    words: words?.length,
    quotes: quotes?.length,
    highlights: highlights?.length,
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/" aria-label="Back">
          ‹
        </a>
        <h1>Saved</h1>
      </header>

      <div className="seg" style={{ margin: '0 16px' }}>
        {(['words', 'quotes', 'highlights'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {counts[t] != null && counts[t]! > 0 ? ` (${counts[t]})` : ''}
          </button>
        ))}
      </div>

      <main className="bank-list">
        {tab === 'words' && (
          <>
            {words?.length === 0 && (
              <p className="empty">No saved words yet — select a word while reading and tap ⭐.</p>
            )}
            {words?.map((w) => (
              <div key={w.id} className="bank-item">
                <div className="bank-main">
                  <span className="bank-term" lang={w.targetLang}>
                    {w.text}
                  </span>
                  {w.translation && <span className="bank-translation">{w.translation}</span>}
                  <span className="bank-context" lang={w.targetLang}>
                    {w.sentence}
                  </span>
                  <span className="bank-meta">
                    {langName(w.targetLang)} · {w.bookTitle}
                  </span>
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Delete ${w.text}`}
                  onClick={() => void deleteSavedWord(w.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'quotes' && (
          <>
            {quotes?.length === 0 && (
              <p className="empty">No quotes yet — tap ☆ in the reader to save a sentence.</p>
            )}
            {quotes?.map((q) => (
              <div key={q.id} className="bank-item">
                <button
                  className="bank-main as-link"
                  disabled={!q.bookId}
                  onClick={() => void jumpTo(q.bookId, q.sentenceIndex)}
                >
                  <span className="bank-quote" lang={q.targetLang}>
                    “{q.text}”
                  </span>
                  {q.translation && <span className="bank-translation">{q.translation}</span>}
                  <span className="bank-meta">
                    {q.bookTitle}
                    {q.author ? ` — ${q.author}` : ''}
                    {q.bookId ? ' · tap to open' : ' · book deleted'}
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label="Delete quote"
                  onClick={() => void deleteSavedQuote(q.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'highlights' && (
          <>
            {highlights?.length === 0 && (
              <p className="empty">No highlights yet — select words while reading and tap 🖍.</p>
            )}
            {highlights?.map((h) => (
              <div key={h.id} className="bank-item">
                <button
                  className="bank-main as-link"
                  onClick={() => void jumpTo(h.bookId, h.sentenceIndex)}
                >
                  <span className="bank-term hl-chip">{h.text}</span>
                  <span className="bank-meta">{bookTitle(h.bookId)} · tap to open</span>
                </button>
                <button
                  className="icon-btn"
                  aria-label="Delete highlight"
                  onClick={() => void removeHighlight(h.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
