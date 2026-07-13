import { useRef, useState } from 'react'
import { explainSelection, type Lookup } from '../translation/wordTranslator'

type TrayState = 'collapsed' | 'loading' | 'open' | 'error'

/**
 * Bottom tray shown while a word/phrase is selected: save/highlight actions,
 * plus a handle you drag up (or tap) to run the deeper "explain" lookup.
 */
export function ExplainTray({
  lookup,
  isHighlighted,
  onSaveWord,
  onToggleHighlight,
}: {
  lookup: Lookup
  isHighlighted: boolean
  onSaveWord: () => Promise<void>
  onToggleHighlight: () => Promise<void>
}) {
  const [state, setState] = useState<TrayState>('collapsed')
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const startY = useRef<number | null>(null)

  function expand() {
    if (state !== 'collapsed' && state !== 'error') return
    setState('loading')
    explainSelection(lookup)
      .then((result) => {
        setText(result)
        setState('open')
      })
      .catch(() => setState('error'))
  }

  return (
    <div
      className={`tray ${state === 'collapsed' ? 'tray-collapsed' : 'tray-open'}`}
      onTouchStart={(e) => {
        startY.current = e.touches[0].clientY
      }}
      onTouchMove={(e) => {
        if (startY.current !== null && startY.current - e.touches[0].clientY > 28) {
          startY.current = null
          expand()
        }
      }}
      onTouchEnd={() => {
        startY.current = null
      }}
    >
      <button className="tray-handle" onClick={expand}>
        <span className="handle-bar" />
        <span className="tray-label">
          {state === 'collapsed' ? 'Explain more' : 'Explanation'}
        </span>
      </button>
      <div className="tray-actions">
        <button
          className="btn secondary"
          disabled={saved}
          onClick={() =>
            void onSaveWord().then(() => {
              setSaved(true)
              setTimeout(() => setSaved(false), 1600)
            })
          }
        >
          {saved ? 'Saved ✓' : '⭐ Save word'}
        </button>
        <button className="btn secondary" onClick={() => void onToggleHighlight()}>
          {isHighlighted ? 'Remove highlight' : '🖍 Highlight'}
        </button>
      </div>
      {state === 'loading' && <p className="muted tray-text">Thinking…</p>}
      {state === 'open' && <p className="tray-text">{text}</p>}
      {state === 'error' && (
        <p className="muted tray-text">Couldn’t load the explanation — tap to retry.</p>
      )}
    </div>
  )
}
