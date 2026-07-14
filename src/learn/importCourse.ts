// Import a course fragment: a single .json, or a .zip of many .json fragments.
// Validates, then merge-persists at course / unit / lesson granularity so units
// and lessons can be added incrementally over time.
import { unzipSync } from 'fflate'
import { db, type LearnLesson, type LearnUnit } from '../db/schema'
import { directionFor } from '../lang/direction'
import { validateFragment, type Fragment } from './validate'

const decoder = new TextDecoder()

/** Read one file into validated fragments (many if it's a zip of jsons). */
async function readFragments(file: File): Promise<Fragment[]> {
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
  const raws: Array<{ name: string; text: string }> = []

  if (isZip) {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    } catch {
      throw new Error('Could not read the .zip')
    }
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.toLowerCase().endsWith('.json') && !name.startsWith('__MACOSX'))
        raws.push({ name, text: decoder.decode(bytes) })
    }
    if (raws.length === 0) throw new Error('The .zip contains no .json files')
  } else {
    raws.push({ name: file.name, text: await file.text() })
  }

  const fragments: Fragment[] = []
  for (const { name, text } of raws) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`${name}: not valid JSON`)
    }
    const res = validateFragment(parsed)
    if (!res.ok) throw new Error(`${name}: ${res.error}`)
    fragments.push(res.fragment)
  }
  return fragments
}

export interface ImportResult {
  courseIds: string[]
  units: number
  lessons: number
}

/** Import + merge a learn file. Returns a summary of what was added/updated. */
export async function importLearnFile(file: File): Promise<ImportResult> {
  const fragments = await readFragments(file)
  const courseIds = new Set<string>()
  let units = 0
  let lessons = 0

  await db.transaction(
    'rw',
    [db.learnCourses, db.learnUnits, db.learnLessons, db.learnFiles],
    async () => {
      for (const frag of fragments) {
        const { course } = frag
        courseIds.add(course.id)
        const existing = await db.learnCourses.get(course.id)
        await db.learnCourses.put({
          id: course.id,
          title: course.title,
          targetLang: course.targetLang,
          baseLang: course.baseLang,
          dir: directionFor(course.targetLang),
          createdAt: existing?.createdAt ?? Date.now(),
        })

        for (const u of frag.units) {
          const unit: LearnUnit = {
            id: u.id,
            courseId: course.id,
            index: u.index,
            title: u.title,
            glossary: u.glossary,
          }
          await db.learnUnits.put(unit)
          units++
          for (const l of u.lessons) {
            const lesson: LearnLesson = {
              id: l.id,
              unitId: u.id,
              courseId: course.id,
              index: l.index ?? 0,
              title: l.title,
              items: l.items,
            }
            await db.learnLessons.put(lesson)
            lessons++
          }
        }
      }
      await db.learnFiles.add({
        id: crypto.randomUUID(),
        name: file.name,
        blob: file,
        createdAt: Date.now(),
      })
    },
  )

  return { courseIds: [...courseIds], units, lessons }
}
