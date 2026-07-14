/** A clean speaker (volume) glyph — inline SVG, no emoji (design-system rule). */
export function SpeakerIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  )
}

/** Small speaker button — plays audio via the caller's onClick (usually useSpeak). */
export function SpeakerButton({
  onClick,
  className = '',
  label = 'Play audio',
}: {
  onClick: () => void
  className?: string
  label?: string
}) {
  return (
    <button
      className={`speaker-btn ${className}`.trim()}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <SpeakerIcon />
    </button>
  )
}
