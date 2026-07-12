import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

// Ask the browser not to evict our books/translations (best-effort; iOS-critical).
navigator.storage?.persist?.().catch(() => {})

if (import.meta.env.DEV) {
  import('./dev').then((m) => m.installDevHooks())
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
