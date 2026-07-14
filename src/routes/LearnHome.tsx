import { SectionTabs, Wordmark } from '../ui'

export default function LearnHome() {
  return (
    <div className="page">
      <header className="topbar">
        <Wordmark />
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <SectionTabs active="learn" />

      <main className="shelf">
        <p className="empty">no courses yet — import a unit to start learning.</p>
      </main>
    </div>
  )
}
