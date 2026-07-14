import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { TxError, type TxErrorCode } from '../translation/openaiClient'
import { translatePhrase, translateWord, type Lookup } from '../translation/wordTranslator'

type Status =
  | { state: 'loading' }
  | { state: 'done'; text: string }
  | { state: 'error'; code: TxErrorCode }

/**
 * Translation bubble anchored ABOVE the selection. No overlay: taps elsewhere
 * pass through, so a second word tap extends the selection instead of closing.
 */
export function SelectionPopover({
  lookup,
  kind,
  anchor,
  onResolved,
}: {
  lookup: Lookup
  kind: 'word' | 'phrase'
  anchor: DOMRect
  onResolved?: (gloss: string) => void
}) {
  const [status, setStatus] = useState<Status>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useEffect(() => {
    let alive = true
    setStatus({ state: 'loading' })
    const run = kind === 'phrase' ? translatePhrase : translateWord
    run(lookup)
      .then((result) => {
        if (!alive) return
        setStatus({ state: 'done', text: result })
        onResolved?.(result)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setStatus({ state: 'error', code: e instanceof TxError ? e.code : 'http' })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.text, lookup.sentence, kind, lookup.model, lookup.apiKey, attempt])

  // always above the selection, clamped to the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    let left = anchor.left + anchor.width / 2 - w / 2
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10))
    const top = Math.max(10, anchor.top - h - 12)
    setStyle({ left, top, visibility: 'visible' })
  }, [anchor, status])

  return (
    <div className="popover" ref={ref} style={style} role="status">
      <div className="popover-body">
        {status.state === 'loading' && <span className="muted">…</span>}
        {status.state === 'done' && <span className="popover-gloss">{status.text}</span>}
        {status.state === 'error' &&
          (status.code === 'no-key' ? (
            <a className="btn" href="#/settings">
              add your key
            </a>
          ) : status.code === 'auth' ? (
            <a className="btn" href="#/settings">
              key rejected
            </a>
          ) : status.code === 'quota' ? (
            <span className="muted">out of credits</span>
          ) : (
            <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
              {status.code === 'offline' ? 'offline — retry' : 'failed — retry'}
            </button>
          ))}
      </div>
    </div>
  )
}
