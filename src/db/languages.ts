// The user's set of study languages + the active one, for the bottom language
// bar. Languages are derived from anything with content — books, courses, or
// word-bank entries — plus any explicitly added (empty) ones in settings.
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './schema'
import { updateSettings, useSettings } from './settings'

const prim = (l: string) => (l ?? '').toLowerCase().split('-')[0]

export const langLabel = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

export interface LanguagesState {
  langs: string[] // primary subtags, sorted by display name
  active: string | undefined // the selected language (falls back to the first)
  ready: boolean
  setActive: (lang: string) => void
  addLanguage: (lang: string) => void
}

export function useLanguages(): LanguagesState {
  const settings = useSettings()
  const books = useLiveQuery(() => db.books.toArray(), [])
  const courses = useLiveQuery(() => db.learnCourses.toArray(), [])
  const vocabLangs = useLiveQuery(() => db.vocab.orderBy('lang').uniqueKeys(), [])

  const ready = books != null && courses != null && vocabLangs != null

  const set = new Set<string>()
  for (const l of settings.languages ?? []) set.add(prim(l))
  for (const b of books ?? []) set.add(prim(b.targetLang))
  for (const c of courses ?? []) set.add(prim(c.targetLang))
  for (const l of vocabLangs ?? []) if (typeof l === 'string') set.add(prim(l))

  const langs = [...set].sort((a, b) => langLabel(a).localeCompare(langLabel(b)))
  const active =
    settings.activeLang && set.has(prim(settings.activeLang)) ? prim(settings.activeLang) : langs[0]

  return {
    langs,
    active,
    ready,
    setActive: (lang) => void updateSettings({ activeLang: prim(lang) }),
    addLanguage: (lang) => {
      const p = prim(lang)
      const next = [...new Set([...(settings.languages ?? []).map(prim), p])]
      void updateSettings({ languages: next, activeLang: p })
    },
  }
}
