import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { TxError, type TxErrorCode } from '../translation/openaiClient'
import {
  explainSelection,
  translatePhrase,
  translateWord,
  type Lookup,
} from '../translation/wordTranslator'

type Status =
  | { state: 'loading' }
  | { state: 'done'; text: string }
  | { state: 'error'; code: TxErrorCode }

/** Anchored gloss popover with graceful failure states (never blocks reading). */
export function SelectionPopover({
  text,
  kind,
  sentence,
  targetLang,
  model,
  apiKey,
  bookId,
  anchor,
  onClose,
}: {
  text: string
  kind: 'word' | 'phrase'
  sentence: string
  targetLang: string
  model: string
  apiKey?: string
  bookId?: string
  anchor: DOMRect
  onClose: () => void
}) {
  const [status, setStatus] = useState<Status>({ state: 'loading' })
  const [explain, setExplain] = useState<Status | null>(null)
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  const lookup: Lookup = { text, sentence, targetLang, model, apiKey, bookId }

  useEffect(() => {
    let alive = true
    setStatus({ state: 'loading' })
    setExplain(null)
    const run = kind === 'phrase' ? translatePhrase : translateWord
    run({ text, sentence, targetLang, model, apiKey, bookId })
      .then((result) => alive && setStatus({ state: 'done', text: result }))
      .catch((e: unknown) => {
        if (!alive) return
        setStatus({ state: 'error', code: e instanceof TxError ? e.code : 'http' })
      })
    return () => {
      alive = false
    }
  }, [text, sentence, kind, targetLang, model, apiKey, bookId, attempt])

  function runExplain() {
    setExplain({ state: 'loading' })
    explainSelection(lookup)
      .then((result) => setExplain({ state: 'done', text: result }))
      .catch((e: unknown) =>
        setExplain({ state: 'error', code: e instanceof TxError ? e.code : 'http' }),
      )
  }

  // position after render: below the selection, flipped above if it would overflow
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    let left = anchor.left + anchor.width / 2 - w / 2
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10))
    let top = anchor.bottom + 10
    if (top + h > window.innerHeight - 10) top = Math.max(10, anchor.top - h - 10)
    setStyle({ left, top, visibility: 'visible' })
  }, [anchor, status, explain])

  const retry = () => setAttempt((a) => a + 1)

  return (
    <>
      <div className="popover-overlay" onClick={onClose} />
      <div
        className="popover"
        ref={ref}
        style={style}
        role="dialog"
        aria-label={`Translation of ${text}`}
      >
        <div className="popover-word">{text}</div>
        <div className="popover-body">
          {status.state === 'loading' && <span className="muted">Translating…</span>}
          {status.state === 'done' && (
            <>
              <span>{status.text}</span>
              {explain === null && (
                <button className="btn secondary" onClick={runExplain}>
                  Explain more
                </button>
              )}
              {explain?.state === 'loading' && <span className="muted">Thinking…</span>}
              {explain?.state === 'done' && <span className="popover-explain">{explain.text}</span>}
              {explain?.state === 'error' && (
                <span className="muted">Couldn’t load explanation — try again.</span>
              )}
            </>
          )}
          {status.state === 'error' &&
            (status.code === 'no-key' ? (
              <>
                <span className="muted">Add your OpenAI key to translate.</span>
                <a className="btn" href="#/settings">
                  Open Settings
                </a>
              </>
            ) : status.code === 'auth' ? (
              <>
                <span className="muted">OpenAI rejected your key.</span>
                <a className="btn" href="#/settings">
                  Check key
                </a>
              </>
            ) : status.code === 'quota' ? (
              <span className="muted">
                Your OpenAI account is out of credits — add funds at
                platform.openai.com/billing.
              </span>
            ) : (
              <>
                <span className="muted">
                  {status.code === 'offline'
                    ? 'You’re offline.'
                    : status.code === 'rate-limit'
                      ? 'Rate limited — try again shortly.'
                      : 'Translation failed.'}
                </span>
                <button className="btn" onClick={retry}>
                  Retry
                </button>
              </>
            ))}
        </div>
      </div>
    </>
  )
}
