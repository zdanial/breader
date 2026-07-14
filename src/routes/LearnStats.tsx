import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/schema'
import { computeStreak } from '../learn/progress'
import { Rule } from '../ui'

const langName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-n">{n}</span>
      <span className="stat-l">{label}</span>
    </div>
  )
}

// last N calendar days as YYYY-MM-DD, oldest first
function lastDays(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d)
    dd.setDate(d.getDate() - i)
    out.push(dd.toISOString().slice(0, 10))
  }
  return out
}

export default function LearnStats() {
  const stats = useLiveQuery(() => db.learnStats.get('singleton'), [])
  const daily = useLiveQuery(() => db.learnDaily.toArray(), [])
  const courses = useLiveQuery(() => db.learnCourses.toArray(), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const vocab = useLiveQuery(() => db.vocab.toArray(), [])

  const streak = computeStreak(stats?.activeDays ?? [])

  // ── over time: xp per day (last 14) ──
  const days = useMemo(() => lastDays(14), [])
  const xpByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of daily ?? []) m.set(d.day, (m.get(d.day) ?? 0) + d.xp)
    return days.map((day) => ({ day, xp: m.get(day) ?? 0 }))
  }, [daily, days])
  const maxXp = Math.max(1, ...xpByDay.map((d) => d.xp))

  // ── by language ──
  const doneLessonIds = useMemo(
    () => new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lessonId)),
    [progress],
  )
  const courseLang = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of courses ?? []) m.set(c.id, c.targetLang)
    return m
  }, [courses])

  const byLang = useMemo(() => {
    const acc = new Map<
      string,
      { xp: number; exercises: number; correct: number; timeMs: number; lessons: number; words: number }
    >()
    const get = (lang: string) => {
      let e = acc.get(lang)
      if (!e) {
        e = { xp: 0, exercises: 0, correct: 0, timeMs: 0, lessons: 0, words: 0 }
        acc.set(lang, e)
      }
      return e
    }
    for (const d of daily ?? []) {
      const e = get(d.lang)
      e.xp += d.xp
      e.exercises += d.exercises
      e.correct += d.correct
      e.timeMs += d.timeMs
    }
    for (const p of progress ?? []) {
      if (!p.completed) continue
      const lang = courseLang.get(p.courseId)
      if (lang) get(lang).lessons += 1
    }
    for (const v of vocab ?? []) get(v.lang).words += 1
    return [...acc.entries()].sort((a, b) => b[1].xp - a[1].xp)
  }, [daily, progress, vocab, courseLang])

  const s = stats
  const accuracy = s && s.totalExercises > 0 ? Math.round((s.totalCorrect / s.totalExercises) * 100) : 0
  const minutes = s ? Math.round(s.totalTimeMs / 60000) : 0

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/learn" aria-label="Back">
          ‹
        </a>
        <h1>stats</h1>
      </header>
      <main className="settings-main">
        <section className="section">
          <h2>overview</h2>
          <div className="stat-grid">
            <Stat n={`${streak}d`} label="streak" />
            <Stat n={String(s?.xp ?? 0)} label="xp" />
            <Stat n={`${accuracy}%`} label="accuracy" />
            <Stat n={`${minutes}m`} label="time" />
            <Stat n={String(doneLessonIds.size)} label={`of ${lessons?.length ?? 0} lessons`} />
            <Stat n={String(s?.activeDays.length ?? 0)} label="active days" />
          </div>
        </section>

        <section className="section">
          <h2>xp · last 14 days</h2>
          <div className="spark">
            {xpByDay.map((d) => (
              <div key={d.day} className="spark-col" title={`${d.day}: ${d.xp} xp`}>
                <div
                  className={`spark-bar${d.xp > 0 ? ' on' : ''}`}
                  style={{ height: `${d.xp > 0 ? Math.max(6, (d.xp / maxXp) * 100) : 2}%` }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>by language</h2>
          {byLang.length === 0 ? (
            <p className="note">no lessons yet — start a course to build stats.</p>
          ) : (
            byLang.map(([lang, e]) => (
              <div key={lang} className="lang-stat">
                <div className="lang-stat-head">
                  <span className="lang-stat-name">{langName(lang).toLowerCase()}</span>
                  <span className="lang-stat-xp">{e.xp} xp</span>
                </div>
                <div className="stat-grid">
                  <Stat n={String(e.lessons)} label="lessons" />
                  <Stat
                    n={`${e.exercises > 0 ? Math.round((e.correct / e.exercises) * 100) : 0}%`}
                    label="accuracy"
                  />
                  <Stat n={String(e.words)} label="words" />
                  <Stat n={`${Math.round(e.timeMs / 60000)}m`} label="time" />
                </div>
              </div>
            ))
          )}
        </section>
        <Rule style={{ opacity: 0 }} />
      </main>
    </div>
  )
}
