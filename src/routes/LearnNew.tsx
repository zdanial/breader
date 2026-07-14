import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../db/schema'
import { buildGeneratorPrompt, courseContextSummary } from '../learn/generatorPrompt'
import { Button, Rule } from '../ui'

const TARGETS: Array<[string, string]> = [
  ['fa', 'Persian'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['he', 'Hebrew'],
  ['ar', 'Arabic'],
]
const BASES: Array<[string, string]> = [
  ['en', 'English'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
]

/** courseId present = "add lessons" to an existing course; absent = new course. */
export default function LearnNew({ courseId }: { courseId?: string }) {
  const course = useLiveQuery(
    () => (courseId ? db.learnCourses.get(courseId) : undefined),
    [courseId],
  )
  const units = useLiveQuery(
    () => (courseId ? db.learnUnits.where('courseId').equals(courseId).toArray() : []),
    [courseId],
  )
  const lessons = useLiveQuery(
    () => (courseId ? db.learnLessons.where('courseId').equals(courseId).toArray() : []),
    [courseId],
  )

  const [newTarget, setNewTarget] = useState('fa')
  const [newBase, setNewBase] = useState('en')
  const [newId, setNewId] = useState('')
  const [copied, setCopied] = useState(false)

  const prompt = useMemo(() => {
    if (courseId && course) {
      const ctx = courseContextSummary(
        course.id,
        units ?? [],
        (uid) => (lessons ?? []).filter((l) => l.unitId === uid).length,
      )
      return buildGeneratorPrompt({ targetLang: course.targetLang, baseLang: course.baseLang, courseContext: ctx })
    }
    const id = (newId.trim() || `${newTarget}-course`).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    return buildGeneratorPrompt({
      targetLang: newTarget,
      baseLang: newBase,
      courseContext: `New course. Use course.id "${id}".`,
    })
  }, [courseId, course, units, lessons, newTarget, newBase, newId])

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/learn" aria-label="Back">
          ‹
        </a>
        <h1>{courseId ? 'add lessons' : 'new course'}</h1>
      </header>
      <main className="settings-main">
        <section className="section">
          <h2>1 · set up</h2>
          {courseId ? (
            <p className="note">
              {course ? `extending “${course.title}”. the prompt below already knows what this course contains.` : ''}
            </p>
          ) : (
            <>
              <div className="field">
                <label>language to learn</label>
                <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
                  {TARGETS.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>explained in</label>
                <select value={newBase} onChange={(e) => setNewBase(e.target.value)}>
                  {BASES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>course id (optional)</label>
                <input
                  type="text"
                  placeholder={`${newTarget}-course`}
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                />
              </div>
            </>
          )}
        </section>

        <section className="section">
          <h2>2 · copy the prompt → your AI</h2>
          <p className="note">
            paste this into ChatGPT or Claude, then paste your source content where it says PASTE. the AI
            will ask you a few questions, then return a JSON file.
          </p>
          <Button onClick={copy}>{copied ? 'copied ✓' : 'copy prompt'}</Button>
          <pre className="prompt-box">{prompt}</pre>
        </section>

        <section className="section">
          <h2>3 · import the file</h2>
          <p className="note">
            save the AI's reply as a <b>.json</b> file (or several as a <b>.zip</b>) and import it from the
            Learn home with <b>+ import unit</b>. it merges into your course.
          </p>
        </section>
        <Rule style={{ opacity: 0 }} />
      </main>
    </div>
  )
}
