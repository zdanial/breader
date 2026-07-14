import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
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
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

type Metric = 'words' | 'exercises' | 'accuracy' | 'time'
const METRICS: Array<[Metric, string]> = [
  ['words', 'words'],
  ['exercises', 'exercises'],
  ['accuracy', 'accuracy'],
  ['time', 'time'],
]

export default function LearnStats() {
  const stats = useLiveQuery(() => db.learnStats.get('singleton'), [])
  const daily = useLiveQuery(() => db.learnDaily.toArray(), [])
  const courses = useLiveQuery(() => db.learnCourses.toArray(), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const vocab = useLiveQuery(() => db.vocab.toArray(), [])

  const [metric, setMetric] = useState<Metric>('words')
  const [sel, setSel] = useState<Set<string>>(new Set()) // empty = all languages

  const streak = computeStreak(stats?.activeDays ?? [])
  const days = useMemo(() => lastDays(14), [])

  // languages present anywhere
  const langs = useMemo(() => {
    const s = new Set<string>()
    for (const d of daily ?? []) s.add(d.lang)
    for (const v of vocab ?? []) s.add(v.lang)
    for (const c of courses ?? []) s.add(c.targetLang)
    return [...s].sort((a, b) => langName(a).localeCompare(langName(b)))
  }, [daily, vocab, courses])

  const inSel = (lang: string) => sel.size === 0 || sel.has(lang)
  const toggle = (lang: string) =>
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(lang)) n.delete(lang)
      else n.add(lang)
      return n
    })

  const courseLang = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of courses ?? []) m.set(c.id, c.targetLang)
    return m
  }, [courses])

  // ── chart series for the selected metric + languages, last 14 days ──
  const series = useMemo(() => {
    const dailyIn = (daily ?? []).filter((d) => inSel(d.lang))
    const vocabIn = (vocab ?? []).filter((v) => inSel(v.lang))
    const map = new Map<string, { exercises: number; correct: number; timeMs: number; words: number }>()
    for (const day of days) map.set(day, { exercises: 0, correct: 0, timeMs: 0, words: 0 })
    for (const d of dailyIn) {
      const e = map.get(d.day)
      if (e) {
        e.exercises += d.exercises
        e.correct += d.correct
        e.timeMs += d.timeMs
      }
    }
    for (const v of vocabIn) {
      const e = map.get(dayOf(v.firstSeenAt))
      if (e) e.words += 1
    }
    return days.map((day) => {
      const e = map.get(day)!
      const value =
        metric === 'words' ? e.words
        : metric === 'exercises' ? e.exercises
        : metric === 'time' ? Math.round(e.timeMs / 60000)
        : e.exercises > 0 ? Math.round((e.correct / e.exercises) * 100) : 0
      return { day, value }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, vocab, days, metric, sel])

  const maxV = metric === 'accuracy' ? 100 : Math.max(1, ...series.map((s) => s.value))
  const unit = metric === 'accuracy' ? '%' : metric === 'time' ? 'm' : ''

  // ── per-language cards ──
  const byLang = useMemo(() => {
    const acc = new Map<string, { exercises: number; correct: number; timeMs: number; lessons: number; words: number }>()
    const get = (l: string) => {
      let e = acc.get(l)
      if (!e) { e = { exercises: 0, correct: 0, timeMs: 0, lessons: 0, words: 0 }; acc.set(l, e) }
      return e
    }
    for (const d of daily ?? []) { const e = get(d.lang); e.exercises += d.exercises; e.correct += d.correct; e.timeMs += d.timeMs }
    for (const p of progress ?? []) { if (p.completed) { const l = courseLang.get(p.courseId); if (l) get(l).lessons += 1 } }
    for (const v of vocab ?? []) get(v.lang).words += 1
    return [...acc.entries()].filter(([l]) => inSel(l)).sort((a, b) => b[1].words - a[1].words)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, progress, vocab, courseLang, sel])

  const doneLessons = (progress ?? []).filter((p) => p.completed).length
  const totalWords = (vocab ?? []).filter((v) => inSel(v.lang)).length
  const totMinutes = Math.round(byLang.reduce((n, [, e]) => n + e.timeMs, 0) / 60000)
  const totEx = byLang.reduce((n, [, e]) => n + e.exercises, 0)
  const totCorrect = byLang.reduce((n, [, e]) => n + e.correct, 0)
  const overallAcc = totEx > 0 ? Math.round((totCorrect / totEx) * 100) : 0

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
            <Stat n={String(totalWords)} label="words" />
            <Stat n={`${overallAcc}%`} label="accuracy" />
            <Stat n={`${totMinutes}m`} label="time" />
            <Stat n={String(doneLessons)} label={`of ${lessons?.length ?? 0} lessons`} />
            <Stat n={String(stats?.activeDays.length ?? 0)} label="active days" />
          </div>
        </section>

        <section className="section">
          <h2>over 14 days</h2>
          {langs.length > 1 && (
            <div className="chip-row">
              <button className={`chip ${sel.size === 0 ? 'on' : ''}`} onClick={() => setSel(new Set())}>
                all
              </button>
              {langs.map((l) => (
                <button key={l} className={`chip ${sel.has(l) ? 'on' : ''}`} onClick={() => toggle(l)}>
                  {langName(l).toLowerCase()}
                </button>
              ))}
            </div>
          )}
          <div className="seg">
            {METRICS.map(([m, label]) => (
              <button key={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>
                {label}
              </button>
            ))}
          </div>
          <div className="spark">
            {series.map((d) => (
              <div key={d.day} className="spark-col" title={`${d.day}: ${d.value}${unit}`}>
                <div
                  className={`spark-bar${d.value > 0 ? ' on' : ''}`}
                  style={{ height: `${d.value > 0 ? Math.max(6, (d.value / maxV) * 100) : 2}%` }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>by language</h2>
          {byLang.length === 0 ? (
            <p className="note">no data yet — study to build your stats.</p>
          ) : (
            byLang.map(([lang, e]) => (
              <div key={lang} className="lang-stat">
                <div className="lang-stat-head">
                  <span className="lang-stat-name">{langName(lang).toLowerCase()}</span>
                  <span className="lang-stat-xp">{e.words} words</span>
                </div>
                <div className="stat-grid">
                  <Stat n={String(e.lessons)} label="lessons" />
                  <Stat n={`${e.exercises > 0 ? Math.round((e.correct / e.exercises) * 100) : 0}%`} label="accuracy" />
                  <Stat n={String(e.exercises)} label="exercises" />
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
