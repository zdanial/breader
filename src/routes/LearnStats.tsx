import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/schema'
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

export default function LearnStats() {
  const stats = useLiveQuery(() => db.learnStats.get('singleton'), [])
  const lessons = useLiveQuery(() => db.learnLessons.toArray(), [])
  const units = useLiveQuery(() => db.learnUnits.toArray(), [])
  const progress = useLiveQuery(() => db.learnProgress.toArray(), [])
  const vocab = useLiveQuery(() => db.vocab.toArray(), [])

  const doneLessonIds = useMemo(
    () => new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lessonId)),
    [progress],
  )
  const unitsDone = useMemo(() => {
    let n = 0
    for (const u of units ?? []) {
      const ls = (lessons ?? []).filter((l) => l.unitId === u.id)
      if (ls.length && ls.every((l) => doneLessonIds.has(l.id))) n++
    }
    return n
  }, [units, lessons, doneLessonIds])

  const vocabByLang = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of vocab ?? []) m.set(v.lang, (m.get(v.lang) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [vocab])

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
          <h2>progress</h2>
          <div className="stat-grid">
            <Stat n={String(doneLessonIds.size)} label={`of ${lessons?.length ?? 0} lessons`} />
            <Stat n={String(unitsDone)} label="units done" />
            <Stat n={`${accuracy}%`} label="accuracy" />
          </div>
        </section>

        <section className="section">
          <h2>effort</h2>
          <div className="stat-grid">
            <Stat n={String(s?.xp ?? 0)} label="xp" />
            <Stat n={String(s?.activeDays.length ?? 0)} label="active days" />
            <Stat n={`${minutes}m`} label="time" />
            <Stat n={String(s?.totalExercises ?? 0)} label="exercises" />
          </div>
        </section>

        <section className="section">
          <h2>vocabulary</h2>
          {vocabByLang.length === 0 ? (
            <p className="note">no words yet — read or learn to build your word bank.</p>
          ) : (
            <div className="stat-grid">
              {vocabByLang.map(([lang, n]) => (
                <Stat key={lang} n={String(n)} label={langName(lang).toLowerCase()} />
              ))}
            </div>
          )}
        </section>
        <Rule style={{ opacity: 0 }} />
      </main>
    </div>
  )
}
