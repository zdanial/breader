import { useEffect, useState } from 'react'

export function useOrientation(): 'portrait' | 'landscape' {
  const [landscape, setLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)')
    const onChange = () => setLandscape(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return landscape ? 'landscape' : 'portrait'
}
