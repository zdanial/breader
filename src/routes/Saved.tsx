import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { deleteSavedQuote, removeHighlight } from '../db/bank'
import { db } from '../db/schema'
import { deleteVocab, deriveStatus } from '../vocab/bank'
import { navigate } from '../router'

type Tab = 'words' | 'quotes' | 'highlights'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

/** "due now" / "due in 3d" — the word's next scheduled review. */
function dueLabel(dueAt: number | undefined): string {
  if (dueAt == null) return ''
  const days = Math.round((dueAt - Date.now()) / 86_400_000)
  if (days <= 0) return 'due now'
  if (days === 1) return 'due tomorrow'
  return `due in ${days}d`
}

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
  // the word bank: every tracked word (from reading + learning), soonest-due first
  const words = useLiveQuery(
    () =>
      db.vocab
        .filter((v) => v.tracked)
        .toArray()
        .then((rows) => rows.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))),
    [],
  )
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
        <h1>saved</h1>
      </header>

      <div className="tabs">
        {(['words', 'quotes', 'highlights'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {counts[t] != null && counts[t]! > 0 ? ` ${counts[t]}` : ''}
          </button>
        ))}
      </div>

      <main className="bank-list">
        {tab === 'words' && (
          <>
            {words?.length === 0 && (
              <p className="empty">
                Your word bank is empty — it fills as you save words while reading and practice
                lessons. Tap ★ word bank on a word, or complete a lesson.
              </p>
            )}
            {words?.map((w) => (
              <div key={w.id} className="bank-item">
                <div className="bank-main">
                  <span className="bank-term" lang={w.lang}>
                    {w.surface ?? w.lemma}
                  </span>
                  {w.gloss && <span className="bank-translation">{w.gloss}</span>}
                  {w.origin?.context && (
                    <span className="bank-context" lang={w.lang}>
                      {w.origin.context}
                    </span>
                  )}
                  <span className="bank-meta">
                    {langName(w.lang)} · {deriveStatus(w)} · {dueLabel(w.dueAt)}
                    {w.origin?.bookId ? ` · ${bookTitle(w.origin.bookId)}` : ''}
                  </span>
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Delete ${w.surface ?? w.lemma}`}
                  onClick={() => void deleteVocab(w.id)}
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
