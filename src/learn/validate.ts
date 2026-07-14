// Validate an AI-generated course fragment before it touches the database.
// Hand-rolled (no dependency); returns the first clear error, since AI output
// isn't always clean.
import type { LessonItem } from '../db/schema'

export interface FragmentLesson {
  id: string
  index?: number
  title: string
  items: LessonItem[]
}
export interface FragmentUnit {
  id: string
  index: number
  title: string
  glossary?: Array<{ word: string; gloss: string; note?: string }>
  lessons: FragmentLesson[]
}
export interface Fragment {
  course: { id: string; title: string; targetLang: string; baseLang: string }
  units: FragmentUnit[]
}

type Res = { ok: true; fragment: Fragment } | { ok: false; error: string }

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isArr = Array.isArray

function validateItem(it: any, where: string): string | null {
  if (!it || typeof it !== 'object' || !isStr(it.type)) return `${where}: missing type`
  switch (it.type) {
    case 'teach':
      if (!isStr(it.title) || !isStr(it.body)) return `${where}: teach needs title + body`
      return null
    case 'choice':
    case 'blank':
      if (!isStr(it.prompt)) return `${where}: ${it.type} needs a prompt`
      if (!isArr(it.choices) || it.choices.length < 2 || !it.choices.every(isStr))
        return `${where}: ${it.type} needs ≥2 string choices`
      if (typeof it.answer !== 'number' || it.answer < 0 || it.answer >= it.choices.length)
        return `${where}: ${it.type} answer index out of range`
      return null
    case 'build':
      if (!isStr(it.prompt)) return `${where}: build needs a prompt`
      if (!isArr(it.tiles) || !it.tiles.every(isStr)) return `${where}: build needs string tiles`
      if (!isArr(it.answer) || it.answer.length < 1 || !it.answer.every(isStr))
        return `${where}: build needs a string[] answer`
      return null
    case 'listen':
      if (!isStr(it.text)) return `${where}: listen needs spoken "text"`
      if (!isArr(it.tiles) || !it.tiles.every(isStr)) return `${where}: listen needs string tiles`
      if (!isArr(it.answer) || it.answer.length < 1 || !it.answer.every(isStr))
        return `${where}: listen needs a string[] answer`
      return null
    case 'match':
      if (!isArr(it.pairs) || it.pairs.length < 2) return `${where}: match needs ≥2 pairs`
      if (!it.pairs.every((p: unknown) => isArr(p) && p.length === 2 && p.every(isStr)))
        return `${where}: match pairs must be [target, base] string tuples`
      return null
    default:
      return `${where}: unknown item type "${it.type}"`
  }
}

export function validateFragment(raw: unknown): Res {
  const r = raw as any
  if (!r || typeof r !== 'object') return { ok: false, error: 'Not a JSON object' }
  if (r.breaderLearn !== 1) return { ok: false, error: 'Missing or unsupported "breaderLearn" version (expected 1)' }

  const c = r.course
  if (!c || !isStr(c.id) || !isStr(c.title) || !isStr(c.targetLang) || !isStr(c.baseLang))
    return { ok: false, error: 'course needs id, title, targetLang, baseLang' }

  // accept `units: [...]` or a single `unit: {...}`
  const rawUnits = isArr(r.units) ? r.units : r.unit ? [r.unit] : null
  if (!rawUnits || rawUnits.length === 0) return { ok: false, error: 'file has no units' }

  const units: FragmentUnit[] = []
  for (let ui = 0; ui < rawUnits.length; ui++) {
    const u = rawUnits[ui]
    const where = `unit[${ui}]`
    if (!u || !isStr(u.id) || !isStr(u.title) || typeof u.index !== 'number')
      return { ok: false, error: `${where}: needs id, title, numeric index` }
    if (!isArr(u.lessons) || u.lessons.length === 0)
      return { ok: false, error: `${where}: needs a non-empty lessons array` }

    const lessons: FragmentLesson[] = []
    for (let li = 0; li < u.lessons.length; li++) {
      const l = u.lessons[li]
      const lw = `${where}.lesson[${li}]`
      if (!l || !isStr(l.id) || !isStr(l.title)) return { ok: false, error: `${lw}: needs id + title` }
      const items = isArr(l.items) ? l.items : isArr(l.exercises) ? l.exercises : null
      if (!items || items.length === 0) return { ok: false, error: `${lw}: needs items/exercises` }
      for (let ii = 0; ii < items.length; ii++) {
        const err = validateItem(items[ii], `${lw}.item[${ii}]`)
        if (err) return { ok: false, error: err }
      }
      lessons.push({ id: l.id, index: typeof l.index === 'number' ? l.index : li + 1, title: l.title, items })
    }
    units.push({ id: u.id, index: u.index, title: u.title, glossary: u.glossary, lessons })
  }

  return {
    ok: true,
    fragment: {
      course: { id: c.id, title: c.title, targetLang: c.targetLang, baseLang: c.baseLang },
      units,
    },
  }
}
