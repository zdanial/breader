import { useState } from 'react'
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../db/settings'

const THEMES = ['system', 'light', 'dark'] as const

export default function Settings() {
  const settings = useSettings()
  // null = untouched (show stored value); string = local edit pending save
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const keyValue = keyDraft ?? settings.openaiKey ?? ''
  const modelValue = modelDraft ?? settings.model
  const dirty = keyDraft !== null || modelDraft !== null

  async function save() {
    await updateSettings({
      openaiKey: keyValue.trim() || undefined,
      model: modelValue.trim() || DEFAULT_SETTINGS.model,
    })
    setKeyDraft(null)
    setModelDraft(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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
          <h2>Translation</h2>
          <div className="field">
            <label>OpenAI API key</label>
            <div className="row">
              <input
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                placeholder="sk-…"
                value={keyValue}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button className="btn secondary" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="field">
            <label>Model</label>
            <input
              type="text"
              autoComplete="off"
              placeholder={DEFAULT_SETTINGS.model}
              value={modelValue}
              onChange={(e) => setModelDraft(e.target.value)}
            />
          </div>
          <div className="row">
            <button className="btn" onClick={save} disabled={!dirty}>
              Save
            </button>
            {saved && <span className="muted">Saved ✓</span>}
          </div>
          <p className="note">
            Your key is stored only on this device and sent only to OpenAI. Nothing else ever
            sees it.
          </p>
        </section>

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
