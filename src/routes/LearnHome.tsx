import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db, type LearnCourse, type LearnLesson, type LearnUnit } from '../db/schema'
import { importLearnFile } from '../learn/importCourse'
import { deleteCourse, resetCourseProgress } from '../learn/ops'
import { navigate } from '../router'
import { Button, Rule, SectionTabs, Sheet, Wordmark } from '../ui'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
const pad2 = (n: number) => String(n).padStart(2, '0')

export default function LearnHome() {
  const courses = useLiveQuery(() => db.learnCourses.orderBy('createdAt').toArray(), [])
  const units = useLiveQuery(() => db.learnUnits.toArray(), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuCourse, setMenuCourse] = useState<LearnCourse | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const doneLessons = useMemo(
    () => new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lessonId)),
    [progress],
  )

  // courses grouped by target language
  const byLang = useMemo(() => {
    const m = new Map<string, LearnCourse[]>()
    for (const c of courses ?? []) {
      const list = m.get(c.targetLang) ?? []
      list.push(c)
      m.set(c.targetLang, list)
    }
    return [...m.entries()].sort((a, b) => langName(a[0]).localeCompare(langName(b[0])))
  }, [courses])

  const unitsOf = (courseId: string): LearnUnit[] =>
    (units ?? []).filter((u) => u.courseId === courseId).sort((a, b) => a.index - b.index)
  const lessonsOf = (unitId: string): LearnLesson[] =>
    (lessons ?? []).filter((l) => l.unitId === unitId).sort((a, b) => a.index - b.index)

  async function onFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const r = await importLearnFile(file)
      void r
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Wordmark />
        {courses && courses.length > 0 && (
          <a className="icon-btn" href="#/learn-stats" aria-label="Stats">
            ▰
          </a>
        )}
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <SectionTabs active="learn" />

      <main className="shelf">
        {courses?.length === 0 && (
          <p className="empty">no courses yet — import a unit to start learning.</p>
        )}
        {error && (
          <p className="error-text" style={{ textAlign: 'center' }}>
            {error}
          </p>
        )}

        {byLang.map(([lang, langCourses]) => (
          <section key={lang} className="lang-section">
            <div className="lang-header" style={{ cursor: 'default' }}>
              <span className="label">{langName(lang).toLowerCase()}</span>
              <span className="lang-count">{pad2(langCourses.length)}</span>
            </div>
            <Rule />

            {langCourses.map((course) => {
              // flattened ordered lesson list → sequential unlock
              const ordered = unitsOf(course.id).flatMap((u) => lessonsOf(u.id))
              const firstLocked = ordered.findIndex((l) => !doneLessons.has(l.id))
              const unlockedUpto = firstLocked === -1 ? ordered.length : firstLocked
              const isUnlocked = (lessonId: string) =>
                ordered.findIndex((l) => l.id === lessonId) <= unlockedUpto

              return (
                <div key={course.id} className="course" dir={course.dir}>
                  <div className="course-title-row" dir="ltr">
                    <span className="course-title">{course.title}</span>
                    <button
                      className="icon-btn"
                      aria-label={`Options for ${course.title}`}
                      onClick={() => {
                        setMenuCourse(course)
                        setConfirmDelete(false)
                      }}
                    >
                      ···
                    </button>
                  </div>
                  {unitsOf(course.id).map((unit) => (
                    <div key={unit.id} className="unit">
                      <div className="unit-head" dir="ltr">
                        <span className="unit-numeral">{pad2(unit.index)}</span>
                        <span className="unit-title">{unit.title}</span>
                      </div>
                      <div className="lesson-path">
                        {lessonsOf(unit.id).map((lesson) => {
                          const done = doneLessons.has(lesson.id)
                          const open = done || isUnlocked(lesson.id)
                          return (
                            <button
                              key={lesson.id}
                              className={`lesson-bubble${done ? ' done' : ''}${open ? '' : ' locked'}`}
                              disabled={!open}
                              onClick={() => navigate(`/lesson/${lesson.id}`)}
                            >
                              <span className="lesson-index">{done ? '✓' : pad2(lesson.index)}</span>
                              <span className="lesson-name" dir="ltr">
                                {lesson.title}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </section>
        ))}
      </main>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      <div style={{ padding: '0 20px calc(20px + env(safe-area-inset-bottom))' }}>
        <Button onClick={() => fileRef.current?.click()} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'importing…' : '+ import unit'}
        </Button>
      </div>

      {menuCourse && (
        <Sheet onClose={() => setMenuCourse(null)}>
          <h2 className="sheet-title">{menuCourse.title}</h2>
          <Rule />
          <Button
            variant="secondary"
            onClick={async () => {
              await resetCourseProgress(menuCourse.id)
              setMenuCourse(null)
            }}
          >
            reset progress
          </Button>
          <Button
            variant={confirmDelete ? 'danger' : 'secondary'}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              await deleteCourse(menuCourse.id)
              setMenuCourse(null)
            }}
          >
            {confirmDelete ? 'tap again to delete course' : 'delete course'}
          </Button>
          <Button variant="secondary" onClick={() => setMenuCourse(null)}>
            cancel
          </Button>
        </Sheet>
      )}
    </div>
  )
}
