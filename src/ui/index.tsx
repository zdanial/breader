// Reusable presentational primitives for the breader design system.
// Square corners, DM Serif Display for brand moments, Inter for chrome,
// the 3px rule as the signature divider. Every screen composes these.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      breader
    </span>
  )
}

/** The signature 3px full-width rule. */
export function Rule({ style }: { style?: React.CSSProperties }) {
  return <span className="rule" style={style} />
}

type BtnVariant = 'primary' | 'secondary' | 'danger'
export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: { variant?: BtnVariant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = variant === 'primary' ? 'btn' : `btn ${variant}`
  return (
    <button className={`${cls} ${className}`.trim()} {...rest}>
      {children}
    </button>
  )
}

export function IconButton({
  className = '',
  children,
  ...rest
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`icon-btn ${className}`.trim()} {...rest}>
      {children}
    </button>
  )
}

/** A 3px progress track with an accent fill. `value` is 0–1. */
export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className="bar">
      <span className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  )
}

/** Bottom sheet with the 3px top rule. Used for import / menu / ToC / dialogs. */
export function Sheet({
  onClose,
  children,
  className = '',
}: {
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`sheet ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
