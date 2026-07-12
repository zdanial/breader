import { updateSettings, useSettings } from '../db/settings'

const THEMES = ['system', 'light', 'dark'] as const

export default function Settings() {
  const settings = useSettings()

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/" aria-label="Back">
          ‹
        </a>
        <h1>Settings</h1>
      </header>
      <main className="settings-main">
        <section className="section">
          <h2>Appearance</h2>
          <div className="field">
            <label>Theme</label>
            <div className="seg">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className={settings.theme === t ? 'active' : ''}
                  onClick={() => updateSettings({ theme: t })}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Reading text size</label>
            <div className="row">
              <button
                className="btn secondary"
                onClick={() =>
                  updateSettings({ fontScale: Math.max(0.7, +(settings.fontScale - 0.1).toFixed(2)) })
                }
              >
                A−
              </button>
              <span>{Math.round(settings.fontScale * 100)}%</span>
              <button
                className="btn secondary"
                onClick={() =>
                  updateSettings({ fontScale: Math.min(1.8, +(settings.fontScale + 0.1).toFixed(2)) })
                }
              >
                A+
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
