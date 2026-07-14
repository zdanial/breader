import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { db, type LearnCourse, type LearnLesson, type LearnUnit } from '../db/schema'
import { importLearnFile } from '../learn/importCourse'
import { deleteCourse, resetCourseProgress } from '../learn/ops'
import { computeStreak } from '../learn/progress'
import { navigate } from '../router'
import { trackedWords } from '../vocab/bank'
import { Button, Rule, SectionTabs, Sheet, Wordmark } from '../ui'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
const pad2 = (n: number) => String(n).padStart(2, '0')

export default function LearnHome() {
  const courses = useLiveQuery(() => db.learnCourses.orderBy('createdAt').toArray(), [])
  const units = useLiveQuery(() => db.learnUnits.toArray(), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const stats = useLiveQuery(() => db.learnStats.get('singleton'), [])
  // per-language word-bank review counts (tracked + due now)
  const reviewInfo = useLiveQuery(async () => {
    const langs = [...new Set((await db.learnCourses.toArray()).map((c) => c.targetLang))]
    const now = Date.now()
    const out: Record<string, { tracked: number; due: number }> = {}
    for (const l of langs) {
      const withGloss = (await trackedWords(l)).filter((v) => v.gloss)
      out[l] = {
        tracked: withGloss.length,
        due: withGloss.filter((v) => (v.dueAt ?? Infinity) <= now).length,
      }
    }
    return out
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuCourse, setMenuCourse] = useState<LearnCourse | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const done = useMemo(
    () => new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lessonId)),
    [progress],
  )
  const streak = computeStreak(stats?.activeDays ?? [])

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
      await importLearnFile(file)
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
        {stats && (stats.activeDays?.length ?? 0) > 0 && (
          <a className="streak-pill" href="#/learn-stats" aria-label="Stats">
            <span className="streak-dot" />
            {streak}d
          </a>
        )}
        <a className="icon-btn" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <SectionTabs active="learn" />

      <main className="shelf">
        {courses?.length === 0 && (
          <p className="empty">
            no courses yet — <a href="#/learn-new">make one with your AI</a>, or import a unit file.
          </p>
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

            {/* word-bank review — per language, pulls due/weak tracked words */}
            {reviewInfo?.[lang]?.tracked ? (
              <button
                className="continue-card review-card"
                dir="ltr"
                onClick={() => navigate(`/review/${lang}`)}
              >
                <span className="continue-eyebrow">word bank · {langName(lang).toLowerCase()}</span>
                <span className="continue-title">review</span>
                <span className="continue-foot">
                  <span className="muted">{reviewInfo[lang].tracked} words tracked</span>
                  <span className="continue-resume">
                    {reviewInfo[lang].due > 0 ? `${reviewInfo[lang].due} due →` : 'practice →'}
                  </span>
                </span>
                <span className="continue-ghost">{pad2(Math.min(99, reviewInfo[lang].due))}</span>
              </button>
            ) : null}

            {langCourses.map((course) => {
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
      <div style={{ padding: '0 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', gap: 10 }}>
        <Button variant="secondary" onClick={() => navigate('/learn-new')} style={{ flex: 1 }}>
          new course
        </Button>
        <Button onClick={() => fileRef.current?.click()} disabled={busy} style={{ flex: 1 }}>
          {busy ? 'importing…' : '+ import unit'}
        </Button>
      </div>

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
