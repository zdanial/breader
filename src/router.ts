import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }
  | { name: 'settings' }
  | { name: 'saved' }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const book = path.match(/^\/book\/([^/]+)$/)
  if (book) return { name: 'reader', bookId: book[1] }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/saved') return { name: 'saved' }
  return { name: 'library' }
}

export function navigate(path: string): void {
  location.hash = path
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
