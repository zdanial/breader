import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clearBookTranslations, deleteBook } from '../db/books'
import { db, type Book } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
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

/** Deterministic pleasant cover color from the title. */
function colorFor(title: string): string {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${h}, 42%, 34%)`
}

function BookCover({
  book,
  coverUrl,
  onOpen,
  onMenu,
}: {
  book: Book
  coverUrl?: string
  onOpen: () => void
  onMenu: () => void
}) {
  const progress =
    book.sentenceCount > 1 ? (book.positionIndex / (book.sentenceCount - 1)) * 100 : 0
  return (
    <div className="cover-card">
      <button className="cover" onClick={onOpen} aria-label={book.title}>
        {coverUrl ? (
          <img className="cover-img" src={coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="cover-front" style={{ background: colorFor(book.title) }}>
            <span className="cover-title">{book.title}</span>
            {book.author && <span className="cover-author">{book.author}</span>}
          </span>
        )}
        <span
          className="cover-menu"
          role="button"
          aria-label={`Options for ${book.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onMenu()
          }}
        >
          ⋯
        </span>
      </button>
      <span className="bar">
        <span className="bar-fill" style={{ width: `${progress}%`, display: 'block' }} />
      </span>
    </div>
  )
}

export default function Library() {
  const books = useLiveQuery(() => db.books.orderBy('createdAt').reverse().toArray(), [])
  const coverRows = useLiveQuery(() => db.covers.toArray(), [])
  const settings = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [lang, setLang] = useState('de')
  const [detected, setDetected] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuBook, setMenuBook] = useState<Book | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)

  // one object URL per cover blob, revoked when the set changes
  const coverUrls = useMemo(
    () => new Map((coverRows ?? []).map((c) => [c.bookId, URL.createObjectURL(c.blob)])),
    [coverRows],
  )
  useEffect(() => () => coverUrls.forEach((url) => URL.revokeObjectURL(url)), [coverUrls])

  const sections = useMemo(() => {
    const byLang = new Map<string, Book[]>()
    for (const book of books ?? []) {
      const list = byLang.get(book.targetLang) ?? []
      list.push(book)
      byLang.set(book.targetLang, list)
    }
    return [...byLang.entries()].sort((a, b) => langName(a[0]).localeCompare(langName(b[0])))
  }, [books])

  const collapsed = settings.collapsedLangs ?? []
  const toggleSection = (code: string) =>
    updateSettings({
      collapsedLangs: collapsed.includes(code)
        ? collapsed.filter((c) => c !== code)
        : [...collapsed, code],
    })

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
      setAuthor(p.parsed.author ?? '')
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
      const bookId = await commitImport(preview, { title, targetLang: lang, author })
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
        <a className="icon-btn" href="#/saved" aria-label="Saved words and quotes">
          ★
        </a>
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

        {sections.map(([code, sectionBooks]) => {
          const isCollapsed = collapsed.includes(code)
          return (
            <section key={code} className="lang-section">
              <button className="lang-header" onClick={() => toggleSection(code)}>
                <span className={isCollapsed ? 'chevron' : 'chevron open'}>›</span>
                <span className="lang-name">{langName(code)}</span>
                <span className="lang-count">{sectionBooks.length}</span>
              </button>
              {!isCollapsed && (
                <div className="cover-grid">
                  {sectionBooks.map((book) => (
                    <BookCover
                      key={book.id}
                      book={book}
                      coverUrl={coverUrls.get(book.id)}
                      onOpen={() => navigate(`/book/${book.id}`)}
                      onMenu={() => openMenu(book)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
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
              <label>Author {preview.parsed.author ? '— detected' : '(optional)'}</label>
              <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
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
              {preview.parsed.cover ? ' · cover found' : ''}
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
