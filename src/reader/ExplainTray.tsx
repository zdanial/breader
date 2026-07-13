import { useRef, useState } from 'react'
import { explainSelection, type Lookup } from '../translation/wordTranslator'
import { Button, Rule } from '../ui'

type TrayState = 'collapsed' | 'loading' | 'open' | 'error'

/**
 * Bottom explain sheet shown while a word/phrase is selected: save/highlight
 * actions, plus a handle you drag up (or tap) to run the deeper explanation.
 * Styled as the design-system bottom sheet — 3px top rule, serif headword.
 */
export function ExplainTray({
  term,
  lookup,
  isHighlighted,
  onSaveWord,
  onToggleHighlight,
}: {
  term: string
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

  const open = state !== 'collapsed'

  return (
    <div
      className={`tray ${open ? 'tray-open' : 'tray-collapsed'}`}
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
        {!open && <span className="tray-label">explain more</span>}
      </button>

      {open && (
        <>
          <div className="tray-headword">
            <span className="word">{term}</span>
            <span className="tray-eyebrow">explanation</span>
          </div>
          <Rule />
          {state === 'loading' && <p className="muted tray-text">thinking…</p>}
          {state === 'open' && <p className="tray-text">{text}</p>}
          {state === 'error' && (
            <p className="muted tray-text">couldn’t load the explanation — tap the handle to retry.</p>
          )}
        </>
      )}

      <div className="tray-actions">
        <Button
          variant="secondary"
          disabled={saved}
          onClick={() =>
            void onSaveWord().then(() => {
              setSaved(true)
              setTimeout(() => setSaved(false), 1600)
            })
          }
        >
          {saved ? 'saved ✓' : '★ save word'}
        </Button>
        <Button variant="secondary" onClick={() => void onToggleHighlight()}>
          {isHighlighted ? 'remove highlight' : '✎ highlight'}
        </Button>
      </div>
    </div>
  )
}
