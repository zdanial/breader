import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../db/schema'
import { importBook } from '../parsing/importBook'
import { acceptedExtensions } from '../parsing/registry'
import { navigate } from '../router'

const LANGS: Array<[string, string]> = [
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
]

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

export default function Library() {
  const books = useLiveQuery(() => db.books.orderBy('createdAt').reverse().toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [lang, setLang] = useState('de')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmImport() {
    if (!pending || busy) return
    setBusy(true)
    setError(null)
    try {
      const bookId = await importBook(pending, lang)
      setPending(null)
      navigate(`/book/${bookId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>breader</h1>
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙︎
        </a>
      </header>

      <main className="shelf">
        {books?.length === 0 && (
          <p className="empty">No books yet — import one to start reading.</p>
        )}
        {books?.map((book) => (
          <button key={book.id} className="book-card" onClick={() => navigate(`/book/${book.id}`)}>
            <span className="book-title">{book.title}</span>
            <span className="book-meta">
              {langName(book.targetLang)} · {book.sentenceCount.toLocaleString()} sentences
            </span>
            <span className="bar">
              <span
                className="bar-fill"
                style={{
                  width: `${
                    book.sentenceCount > 1
                      ? (book.positionIndex / (book.sentenceCount - 1)) * 100
                      : 0
                  }%`,
                  display: 'block',
                }}
              />
            </span>
          </button>
        ))}
      </main>

      <input
        ref={fileRef}
        type="file"
        accept={acceptedExtensions()}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            setPending(file)
            setError(null)
          }
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <button className="fab" onClick={() => fileRef.current?.click()}>
        + Import book
      </button>

      {pending && (
        <div className="modal-overlay" onClick={() => !busy && setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import “{pending.name}”</h2>
            <div className="field">
              <label>Book language (what you’re learning)</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="row">
              <button className="btn secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn" onClick={confirmImport} disabled={busy}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
