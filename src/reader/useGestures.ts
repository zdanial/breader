import { useRef, type RefObject, type TouchEvent } from 'react'

const MIN_SWIPE_PX = 48
const AXIS_DOMINANCE = 1.2

/**
 * Swipe navigation on both axes (DESIGN.md): left/up = next, right/down = prev.
 * Vertical swipes are ignored while the sentence itself is scrollable, so an
 * overflowing sentence scrolls naturally and only horizontal swipes turn the page.
 */
export function useSwipe({
  onNext,
  onPrev,
  scrollRef,
}: {
  onNext: () => void
  onPrev: () => void
  scrollRef: RefObject<HTMLElement | null>
}) {
  const start = useRef<{ x: number; y: number } | null>(null)

  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      const el = scrollRef.current
      const contentScrolls = !!el && el.scrollHeight > el.clientHeight + 4

      if (ax > MIN_SWIPE_PX && ax > ay * AXIS_DOMINANCE) {
        dx < 0 ? onNext() : onPrev()
      } else if (!contentScrolls && ay > MIN_SWIPE_PX && ay > ax * AXIS_DOMINANCE) {
        dy < 0 ? onNext() : onPrev()
      }
    },
  }
}
