export default function Library() {
  return (
    <div className="page">
      <header className="topbar">
        <h1>breader</h1>
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙︎
        </a>
      </header>
      <main className="shelf">
        <p className="empty">No books yet.</p>
      </main>
    </div>
  )
}
