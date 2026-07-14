import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../db/schema'
import {
  ACCENT_CHOICES,
  DEFAULT_ACCENT,
  DEFAULT_SETTINGS,
  FONT_STACKS,
  TTS_VOICES,
  updateSettings,
  useSettings,
} from '../db/settings'
import { useSpeak } from '../tts/useSpeak'
import { Button, Rule } from '../ui'

const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

const THEMES = ['system', 'light', 'dark'] as const
const FONTS: Array<[string, string]> = [
  ['serif', 'serif'],
  ['sans', 'sans'],
]
const ALIGNS = ['center', 'left', 'justify'] as const

export default function Settings() {
  const settings = useSettings()
  const { say } = useSpeak()
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(
    null,
  )
  const translationCount = useLiveQuery(() => db.translations.count(), [])

  useEffect(() => {
    Promise.all([
      navigator.storage?.estimate?.() ?? Promise.resolve({}),
      navigator.storage?.persisted?.() ?? Promise.resolve(undefined),
    ]).then(([est, persisted]) => setStorage({ usage: est.usage, quota: est.quota, persisted }))
  }, [])

  const keyValue = keyDraft ?? settings.openaiKey ?? ''
  const modelValue = modelDraft ?? settings.model
  const dirty = keyDraft !== null || modelDraft !== null
  const accent = settings.accentColor ?? DEFAULT_ACCENT

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
        <h1>settings</h1>
      </header>
      <main className="settings-main">
        <section className="section">
          <h2>translation</h2>
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
              <Button variant="secondary" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'hide' : 'show'}
              </Button>
            </div>
          </div>
          <div className="field">
            <label>model</label>
            <input
              type="text"
              autoComplete="off"
              placeholder={DEFAULT_SETTINGS.model}
              value={modelValue}
              onChange={(e) => setModelDraft(e.target.value)}
            />
          </div>
          <div className="row">
            <Button onClick={save} disabled={!dirty}>
              save
            </Button>
            {saved && <span className="muted">saved ✓</span>}
          </div>
          <div className="field">
            <label>voice (audio)</label>
            <div className="row">
              <select
                value={settings.ttsVoice ?? 'alloy'}
                onChange={(e) => updateSettings({ ttsVoice: e.target.value })}
                style={{ flex: 1 }}
              >
                {TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => say('Hello, this is your reading voice.')}>
                ▶ test
              </Button>
            </div>
          </div>
          <p className="note">
            your key is stored only on this device and sent only to OpenAI. nothing else ever sees it.
            audio uses OpenAI text-to-speech and is cached on device.
          </p>
        </section>

        <section className="section">
          <h2>appearance</h2>
          <div className="field">
            <label>theme</label>
            <div className="seg">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className={settings.theme === t ? 'active' : ''}
                  onClick={() => updateSettings({ theme: t })}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>accent</label>
            <div className="swatches">
              {ACCENT_CHOICES.map(([hex, name]) => (
                <button
                  key={hex}
                  className={accent.toLowerCase() === hex ? 'swatch active' : 'swatch'}
                  style={{ background: hex }}
                  aria-label={name}
                  onClick={() => updateSettings({ accentColor: hex })}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>reading font</label>
            <div className="seg">
              {FONTS.map(([key, name]) => (
                <button
                  key={key}
                  className={settings.fontFamily === key ? 'active' : ''}
                  style={{ fontFamily: FONT_STACKS[key] }}
                  onClick={() => updateSettings({ fontFamily: key })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>text alignment</label>
            <div className="seg">
              {ALIGNS.map((a) => (
                <button
                  key={a}
                  className={(settings.readAlign ?? 'center') === a ? 'active' : ''}
                  onClick={() => updateSettings({ readAlign: a })}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>reading text size</label>
            <div className="row">
              <Button
                variant="secondary"
                onClick={() =>
                  updateSettings({ fontScale: Math.max(0.4, +(settings.fontScale - 0.1).toFixed(2)) })
                }
              >
                A−
              </Button>
              <span className="muted">{Math.round(settings.fontScale * 100)}%</span>
              <Button
                variant="secondary"
                onClick={() =>
                  updateSettings({ fontScale: Math.min(1.8, +(settings.fontScale + 0.1).toFixed(2)) })
                }
              >
                A+
              </Button>
            </div>
          </div>
        </section>

        <section className="section">
          <h2>storage</h2>
          <p className="note">
            {storage?.usage != null && storage?.quota != null
              ? `using ${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} available.`
              : 'storage usage unavailable.'}
            {translationCount != null && ` ${translationCount.toLocaleString()} cached translations.`}
          </p>
          <p className="note">
            {storage?.persisted
              ? 'persistent storage granted — your books won’t be evicted.'
              : 'persistent storage not yet granted; usually granted once the app is installed to your home screen.'}
          </p>
        </section>
        <Rule style={{ opacity: 0 }} />
      </main>
    </div>
  )
}
