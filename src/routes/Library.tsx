import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { clearBookTranslations, deleteBook } from '../db/books'
import { db, type Book } from '../db/schema'
import { useSettings } from '../db/settings'
import { commitImport, prepareImport, type ImportPreview } from '../parsing/importBook'
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
  const settings = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [title, setTitle] = useState('')
  const [lang, setLang] = useState('de')
  const [detected, setDetected] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuBook, setMenuBook] = useState<Book | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)

  function openMenu(book: Book) {
    setMenuBook(book)
    setConfirmDelete(false)
    setCleared(null)
  }

  async function onFilePicked(file: File) {
    setParsing(true)
    setError(null)
    try {
      const p = await prepareImport(file)
      setPreview(p)
      setTitle(p.parsed.title)
      setLang(p.suggestedLang && LANGS.some(([c]) => c === p.suggestedLang) ? p.suggestedLang : 'de')
      setDetected(!!p.suggestedLang)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read file')
    } finally {
      setParsing(false)
    }
  }

  async function confirmImport() {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const bookId = await commitImport(preview, { title, targetLang: lang })
      setPreview(null)
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
        {books && !settings.openaiKey && (
          <p className="note" style={{ textAlign: 'center' }}>
            Tip: add your OpenAI key in <a href="#/settings">Settings</a> to enable tap-to-translate.
          </p>
        )}
        {books?.length === 0 && (
          <p className="empty">No books yet — import one to start reading.</p>
        )}
        {error && !preview && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}
        {books?.map((book) => (
          <button key={book.id} className="book-card" onClick={() => navigate(`/book/${book.id}`)}>
            <span className="row" style={{ justifyContent: 'space-between' }}>
              <span className="book-title">{book.title}</span>
              <span
                className="icon-btn book-menu"
                role="button"
                aria-label={`Options for ${book.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  openMenu(book)
                }}
              >
                ⋯
              </span>
            </span>
            <span className="book-meta">
              {langName(book.targetLang)}
              {book.author ? ` · ${book.author}` : ''} · {book.sentenceCount.toLocaleString()}{' '}
              sentences
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
          if (file) void onFilePicked(file)
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <button className="fab" onClick={() => fileRef.current?.click()} disabled={parsing}>
        {parsing ? 'Reading…' : '+ Import book'}
      </button>

      {menuBook && (
        <div className="modal-overlay" onClick={() => setMenuBook(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{menuBook.title}</h2>
            <button
              className="btn secondary"
              onClick={async () => {
                const n = await clearBookTranslations(menuBook.id)
                setCleared(n)
              }}
            >
              {cleared === null
                ? 'Clear cached translations'
                : `Cleared ${cleared.toLocaleString()} translations ✓`}
            </button>
            <button
              className={confirmDelete ? 'btn danger' : 'btn secondary'}
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                await deleteBook(menuBook.id)
                setMenuBook(null)
              }}
            >
              {confirmDelete ? 'Tap again to permanently delete' : 'Delete book'}
            </button>
            <button className="btn secondary" onClick={() => setMenuBook(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => !busy && setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import book</h2>
            <div className="field">
              <label>Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>
                Book language (what you’re learning)
                {detected && <span> — detected</span>}
              </label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <p className="note">
              {preview.parsed.chapters.length.toLocaleString()} chapter
              {preview.parsed.chapters.length === 1 ? '' : 's'}
              {preview.parsed.author ? ` · ${preview.parsed.author}` : ''}
            </p>
            {error && <p className="error-text">{error}</p>}
            <div className="row">
              <button className="btn secondary" onClick={() => setPreview(null)} disabled={busy}>
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
