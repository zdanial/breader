import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }
  | { name: 'settings' }
  | { name: 'saved' }
  | { name: 'learn' }
  | { name: 'learn-stats' }
  | { name: 'learn-new'; courseId?: string }
  | { name: 'lesson'; lessonId: string }
  | { name: 'review'; lang: string }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const book = path.match(/^\/book\/([^/]+)$/)
  if (book) return { name: 'reader', bookId: book[1] }
  const lesson = path.match(/^\/lesson\/([^/]+)$/)
  if (lesson) return { name: 'lesson', lessonId: lesson[1] }
  const review = path.match(/^\/review\/([^/]+)$/)
  if (review) return { name: 'review', lang: review[1] }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/saved') return { name: 'saved' }
  if (path === '/learn') return { name: 'learn' }
  if (path === '/learn-stats') return { name: 'learn-stats' }
  if (path === '/learn-new') return { name: 'learn-new' }
  const addLessons = path.match(/^\/learn-new\/([^/]+)$/)
  if (addLessons) return { name: 'learn-new', courseId: addLessons[1] }
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
