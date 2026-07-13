import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Measure-and-fit: scales a sentence so it fills its box without overflowing.
 * Starts from the user's chosen size (the ceiling) and binary-searches down
 * until the text fits both axes. Re-runs on text/ceiling change and on any box
 * resize (rotation, orientation). The caller supplies the box ref (shared with
 * swipe/overflow) whose FIRST element child is the sentence being sized.
 */
export function useFitText(
  boxRef: RefObject<HTMLElement | null>,
  deps: { text: string; maxPx: number; minPx?: number; enabled?: boolean; revalidate?: unknown },
): number {
  const { text, maxPx, minPx = 12, enabled = true, revalidate } = deps
  const [fontPx, setFontPx] = useState(maxPx)

  const measure = useCallback(() => {
    const box = boxRef.current
    const el = box?.firstElementChild as HTMLElement | null
    if (!box || !el || box.clientHeight === 0) return
    if (!enabled) {
      setFontPx(maxPx)
      return
    }

    // clientHeight/Width include padding — subtract it so reserved bottom space
    // (e.g. for the explain tray) actually shrinks the area the text may fill
    const cs = getComputedStyle(box)
    const availH =
      box.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0')
    const availW =
      box.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')

    const fits = (px: number) => {
      el.style.fontSize = `${px}px`
      // tolerance so sub-pixel rounding doesn't force a needless shrink
      return el.scrollHeight <= availH + 1 && el.scrollWidth <= availW + 1
    }

    let resolved = maxPx
    if (!fits(maxPx)) {
      let lo = minPx
      let hi = maxPx
      for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      resolved = Math.floor(lo)
    }
    el.style.fontSize = `${resolved}px`
    setFontPx(resolved)
  }, [boxRef, maxPx, minPx, enabled])

  useLayoutEffect(measure, [measure, text, revalidate])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    ro.observe(box)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [boxRef, measure])

  return fontPx
}
