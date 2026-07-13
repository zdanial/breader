import { useEffect } from 'react'
import { useRoute } from './router'
import { useSettings } from './db/settings'
import Library from './routes/Library'
import Reader from './routes/Reader'
import Saved from './routes/Saved'
import Settings from './routes/Settings'

export default function App() {
  const route = useRoute()
  const settings = useSettings()

  // Theme: follow system when 'system', otherwise the manual choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme =
        settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  // Accent is a global custom property so every component inherits it.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accentColor ?? '#2e63e8')
  }, [settings.accentColor])

  switch (route.name) {
    case 'reader':
      // key forces a fresh Reader per book so position state never leaks across books
      return <Reader key={route.bookId} bookId={route.bookId} />
    case 'settings':
      return <Settings />
    case 'saved':
      return <Saved />
    default:
      return <Library />
  }
}
