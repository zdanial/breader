import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db, type LearnCourse, type LearnLesson, type LearnUnit } from '../db/schema'
import { useLanguages } from '../db/languages'
import { importLearnFile } from '../learn/importCourse'
import { deleteCourse, resetCourseProgress } from '../learn/ops'
import { computeStreak } from '../learn/progress'
import { navigate } from '../router'
import { dirFor, wordBankSummary } from '../vocab/review'
import { Button, LanguageBar, Rule, SavedStar, SectionTabs, Sheet, StatsPill, Wordmark } from '../ui'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
const pad2 = (n: number) => String(n).padStart(2, '0')
const prim = (l: string) => (l ?? '').toLowerCase().split('-')[0]

// languages the user can add a course for
const ADDABLE: string[] = ['fa', 'de', 'fr', 'es', 'it', 'pt', 'he', 'ar', 'ja', 'zh', 'ru', 'ko']

export default function LearnHome() {
  const courses = useLiveQuery(() => db.learnCourses.orderBy('createdAt').toArray(), [])
  const units = useLiveQuery(() => db.learnUnits.toArray(), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const stats = useLiveQuery(() => db.learnStats.get('singleton'), [])
  const { langs, active, setActive, addLanguage } = useLanguages()

  // word-bank summary (counts + preview surfaces) for the active language
  const review = useLiveQuery(
    () => (active ? wordBankSummary(active) : Promise.resolve({ tracked: 0, due: 0, preview: [] })),
    [active],
  )

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pickLang, setPickLang] = useState(false)
  const [menuCourse, setMenuCourse] = useState<LearnCourse | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const done = useMemo(
    () => new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lessonId)),
    [progress],
  )
  const streak = computeStreak(stats?.activeDays ?? [])

  const activeCourses = useMemo(
    () => (courses ?? []).filter((c) => prim(c.targetLang) === active),
    [courses, active],
  )

  const unitsOf = (courseId: string): LearnUnit[] =>
    (units ?? []).filter((u) => u.courseId === courseId).sort((a, b) => a.index - b.index)
  const lessonsOf = (unitId: string): LearnLesson[] =>
    (lessons ?? []).filter((l) => l.unitId === unitId).sort((a, b) => a.index - b.index)

  async function onFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      await importLearnFile(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const addable = ADDABLE.filter((c) => !langs.includes(c))

  return (
    <div className="page">
      <header className="topbar">
        <Wordmark />
        <SavedStar />
        <StatsPill streak={streak} />
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <SectionTabs active="learn" />

      <main className="shelf has-langbar">
        {error && (
          <p className="error-text" style={{ textAlign: 'center' }}>
            {error}
          </p>
        )}
        {busy && <p className="note" style={{ textAlign: 'center' }}>importing…</p>}

        {langs.length === 0 ? (
          <p className="empty">no languages yet — tap ＋ to add one and generate your first course.</p>
        ) : (
          <>
            {/* word-bank card for the active language: card body → review, tiles → saved */}
            {review && review.tracked > 0 && active && (
              <div className="wordbank-card" dir="ltr">
                <div className="wordbank-top">
                  <span className="wordbank-eyebrow">word bank · {langName(active).toLowerCase()}</span>
                  <button className="wordbank-action" onClick={() => navigate(`/review/${active}`)}>
                    {review.due > 0 ? `review ${review.due} due →` : 'practice →'}
                  </button>
                </div>
                {review.preview.length > 0 && (
                  <div className="wordbank-preview" dir={dirFor(active)}>
                    {review.preview.map((surface) => (
                      <button
                        key={surface}
                        className="tile wordbank-tile"
                        onClick={() => navigate('/saved')}
                      >
                        {surface}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeCourses.length === 0 ? (
              <p className="empty">
                no courses in {active ? langName(active) : 'this language'} yet — tap ＋ to import or
                generate content.
              </p>
            ) : (
              activeCourses.map((course) => {
                const us = unitsOf(course.id)
                const ordered = us.flatMap((u) => lessonsOf(u.id).map((l) => ({ l, u })))
                const currentPos = ordered.findIndex((x) => !done.has(x.l.id))
                const current = currentPos >= 0 ? ordered[currentPos] : null

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

                    {/* continue card — the current lesson */}
                    {current && (
                      <button
                        className="continue-card"
                        dir="ltr"
                        onClick={() => navigate(`/lesson/${current.l.id}`)}
                      >
                        <span className="continue-eyebrow">continue · unit {pad2(current.u.index)}</span>
                        <span className="continue-title" dir="auto">
                          {current.l.title}
                        </span>
                        <span className="continue-foot">
                          <span className="muted">{current.u.title}</span>
                          <span className="continue-resume">resume →</span>
                        </span>
                        <span className="continue-ghost">{pad2(current.u.index)}</span>
                      </button>
                    )}

                    {us.map((unit) => {
                      const uls = lessonsOf(unit.id)
                      const allDone = uls.length > 0 && uls.every((l) => done.has(l.id))
                      const hasCurrent = current?.u.id === unit.id
                      const someDone = uls.some((l) => done.has(l.id))
                      const status = allDone ? 'done' : hasCurrent || someDone ? 'progress' : null
                      return (
                        <div key={unit.id} className="unit">
                          <div className="unit-head" dir="ltr">
                            <span className="unit-numeral">{pad2(unit.index)}</span>
                            <span className="unit-title">{unit.title}</span>
                            {status && (
                              <span className={`unit-status ${status}`}>
                                {status === 'done' ? 'done' : 'in progress'}
                              </span>
                            )}
                          </div>
                          <div className="lesson-rows">
                            {uls.map((lesson) => {
                              const isDone = done.has(lesson.id)
                              const isCurrent = current?.l.id === lesson.id
                              const state = isDone ? 'done' : isCurrent ? 'current' : 'locked'
                              return (
                                <button
                                  key={lesson.id}
                                  className={`lesson-row ${state}`}
                                  dir="ltr"
                                  disabled={state === 'locked'}
                                  onClick={() => navigate(`/lesson/${lesson.id}`)}
                                >
                                  <span className="signal" />
                                  <span className="lesson-name" dir="auto">
                                    {lesson.title}
                                  </span>
                                  {isCurrent && <span className="row-action">start →</span>}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </>
        )}
      </main>

      <LanguageBar langs={langs} active={active} onSelect={setActive} onAdd={() => setAddOpen(true)} />

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

      {/* the mode-aware add sheet for learn: import content · generate · add language */}
      {addOpen && (
        <Sheet onClose={() => setAddOpen(false)}>
          <h2 className="sheet-title">add {active ? `to ${langName(active).toLowerCase()}` : 'content'}</h2>
          <Rule />
          <Button
            onClick={() => {
              setAddOpen(false)
              navigate('/learn-new')
            }}
          >
            ✳ generate instructions
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setAddOpen(false)
              fileRef.current?.click()
            }}
          >
            ↥ import content
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setAddOpen(false)
              setPickLang(true)
            }}
          >
            ＋ add language
          </Button>
          <Button variant="secondary" onClick={() => setAddOpen(false)}>
            cancel
          </Button>
        </Sheet>
      )}

      {/* language picker for "add language" */}
      {pickLang && (
        <Sheet onClose={() => setPickLang(false)}>
          <h2 className="sheet-title">add a language</h2>
          <Rule />
          <div className="lang-pick">
            {addable.map((code) => (
              <button
                key={code}
                className="lang-pick-item"
                onClick={() => {
                  addLanguage(code)
                  setPickLang(false)
                }}
              >
                {langName(code).toLowerCase()}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setPickLang(false)}>
            cancel
          </Button>
        </Sheet>
      )}

      {menuCourse && (
        <Sheet onClose={() => setMenuCourse(null)}>
          <h2 className="sheet-title">{menuCourse.title}</h2>
          <Rule />
          <Button onClick={() => navigate(`/learn-new/${menuCourse.id}`)}>+ add lessons</Button>
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
