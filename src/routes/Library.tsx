import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clearBookTranslations, deleteBook } from '../db/books'
import { db, type Book } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { commitImport, prepareImport, type ImportPreview } from '../parsing/importBook'
import { acceptedExtensions } from '../parsing/registry'
import { navigate } from '../router'
import { Button, ProgressBar, Rule, Sheet, Wordmark } from '../ui'

const LANGS: Array<[string, string]> = [
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['he', 'Hebrew'],
  ['ar', 'Arabic'],
]

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Deterministic pleasant cover color from the title. */
function colorFor(title: string): string {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${h}, 38%, 30%)`
}

/** Readable text color (black/white) over a given hsl() cover color. */
function inkOn(hsl: string): string {
  const l = Number(hsl.match(/,\s*([\d.]+)%\)$/)?.[1] ?? 50)
  return l > 62 ? '#141414' : '#f2f0ea'
}

function BookCover({
  book,
  coverUrl,
  live,
  onOpen,
  onMenu,
}: {
  book: Book
  coverUrl?: string
  live: boolean
  onOpen: () => void
  onMenu: () => void
}) {
  const bg = colorFor(book.title)
  const fg = inkOn(bg)
  const progress = book.sentenceCount > 1 ? book.positionIndex / (book.sentenceCount - 1) : 0
  return (
    <div className="cover-card">
      <button className="cover" onClick={onOpen} aria-label={book.title}>
        {coverUrl ? (
          <img className="cover-img" src={coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="cover-front" style={{ background: bg, color: fg }}>
            <span className="cover-title">{book.title}</span>
            {book.author && <span className="cover-author">{book.author}</span>}
          </span>
        )}
        {live && <span className="cover-live" />}
        <span
          className="cover-menu"
          role="button"
          aria-label={`Options for ${book.title}`}
          style={{ color: coverUrl ? '#fff' : fg }}
          onClick={(e) => {
            e.stopPropagation()
            onMenu()
          }}
        >
          ···
        </span>
      </button>
      <ProgressBar value={progress} color={live ? undefined : 'var(--fg)'} />
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
        <Wordmark />
        <a className="icon-btn" href="#/saved" aria-label="Saved words and quotes">
          ★
        </a>
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>

      <main className="shelf">
        {books && !settings.openaiKey && (
          <p className="note" style={{ textAlign: 'center' }}>
            add your OpenAI key in <a href="#/settings">settings</a> to enable tap-to-translate.
          </p>
        )}
        {books?.length === 0 && <p className="empty">no books yet — import one to start reading.</p>}
        {error && !preview && (
          <p className="error-text" style={{ textAlign: 'center' }}>
            {error}
          </p>
        )}

        {sections.map(([code, sectionBooks]) => {
          const isCollapsed = collapsed.includes(code)
          return (
            <section key={code} className="lang-section">
              <button className="lang-header" onClick={() => toggleSection(code)}>
                <span className="label">
                  <span className={isCollapsed ? 'chevron' : 'chevron open'}>›</span>
                  {langName(code).toLowerCase()}
                </span>
                <span className="lang-count">{pad2(sectionBooks.length)}</span>
              </button>
              <Rule />
              {!isCollapsed && (
                <div className="cover-grid">
                  {sectionBooks.map((book) => (
                    <BookCover
                      key={book.id}
                      book={book}
                      coverUrl={coverUrls.get(book.id)}
                      live={book.id === settings.lastReadBookId}
                      onOpen={() => navigate(`/book/${book.id}`)}
                      onMenu={() => openMenu(book)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}

        {books && books.length > 0 && (
          <div className="import-bar">
            <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
              {parsing ? 'reading…' : '+ import book'}
            </Button>
          </div>
        )}
      </main>

      {books?.length === 0 && (
        <div style={{ padding: '0 20px calc(20px + env(safe-area-inset-bottom))' }}>
          <Button onClick={() => fileRef.current?.click()} disabled={parsing} style={{ width: '100%' }}>
            {parsing ? 'reading…' : '+ import book'}
          </Button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={acceptedExtensions()}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onFilePicked(file)
          e.target.value = ''
        }}
      />

      {menuBook && (
        <Sheet onClose={() => setMenuBook(null)}>
          <h2 className="sheet-title">{menuBook.title}</h2>
          <Rule />
          <Button
            variant="secondary"
            onClick={async () => setCleared(await clearBookTranslations(menuBook.id))}
          >
            {cleared === null
              ? 'clear cached translations'
              : `cleared ${cleared.toLocaleString()} translations ✓`}
          </Button>
          <Button
            variant={confirmDelete ? 'danger' : 'secondary'}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              await deleteBook(menuBook.id)
              setMenuBook(null)
            }}
          >
            {confirmDelete ? 'tap again to permanently delete' : 'delete book'}
          </Button>
          <Button variant="secondary" onClick={() => setMenuBook(null)}>
            cancel
          </Button>
        </Sheet>
      )}

      {preview && (
        <Sheet onClose={() => !busy && setPreview(null)}>
          <h2 className="sheet-title">import book</h2>
          <Rule />
          <div className="field">
            <label>title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>author {preview.parsed.author ? '— detected' : '(optional)'}</label>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="field">
            <label>language {detected ? '— detected' : ''}</label>
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
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy} style={{ flex: 1 }}>
              cancel
            </Button>
            <Button onClick={confirmImport} disabled={busy} style={{ flex: 1 }}>
              {busy ? 'importing…' : 'import'}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
