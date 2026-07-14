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
      ♪
    </button>
  )
}
