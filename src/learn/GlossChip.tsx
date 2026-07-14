import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { resolveGloss, type GlossSource } from './gloss'

/** A gloss chip anchored above a word — reuses the reader's chip styling. */
export function GlossChip({
  word,
  anchor,
  src,
  onClose,
}: {
  word: string
  anchor: DOMRect
  src: GlossSource
  onClose: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'done' | 'none'>('loading')
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useEffect(() => {
    let alive = true
    resolveGloss(word, src).then((r) => {
      if (!alive) return
      if (r) {
        setText(r.gloss)
        setState('done')
      } else setState('none')
    })
    return () => {
      alive = false
    }
  }, [word, src])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    let left = anchor.left + anchor.width / 2 - w / 2
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10))
    const top = Math.max(10, anchor.top - h - 10)
    setStyle({ left, top, visibility: 'visible' })
  }, [anchor, state])

  return (
    <>
      <div className="popover-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div className="popover" ref={ref} style={style} role="status">
        <div className="popover-body">
          {state === 'loading' && <span className="muted">…</span>}
          {state === 'done' && <span className="popover-gloss">{text}</span>}
          {state === 'none' && <span className="muted">add a key for glosses</span>}
        </div>
      </div>
    </>
  )
}
