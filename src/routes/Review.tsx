import { useEffect, useState } from 'react'
import { db } from '../db/schema'
import { useSettings } from '../db/settings'
import type { GlossSource } from '../learn/gloss'
import { buildReviewSession, type ReviewSession } from '../vocab/review'
import { LessonPlayer, type LessonSummary } from './Lesson'

const todayKey = () => new Date().toISOString().slice(0, 10)
const langName = (code: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

/** Local word-bank review — an ad-hoc session run through the shared player.
 *  Grades feed the SM-2 scheduler during play; here we only log activity so a
 *  review keeps the streak and stats (no learnProgress — reviews aren't lessons). */
export default function Review({ lang }: { lang: string }) {
  const settings = useSettings()
  const [session, setSession] = useState<ReviewSession | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    void buildReviewSession(lang).then((s) => { if (live) setSession(s) })
    return () => { live = false }
  }, [lang])

  async function onFinish(s: LessonSummary) {
    const day = todayKey()
    const stats = (await db.learnStats.get('singleton')) ?? {
      id: 'singleton' as const, totalExercises: 0, totalCorrect: 0, totalTimeMs: 0, activeDays: [],
    }
    stats.totalExercises += s.graded
    stats.totalCorrect += s.firstTry
    stats.totalTimeMs += s.timeMs
    if (!stats.activeDays.includes(day)) stats.activeDays.push(day)
    await db.learnStats.put(stats)

    const did = `${lang}:${day}`
    const d = (await db.learnDaily.get(did)) ?? { id: did, lang, day, exercises: 0, correct: 0, timeMs: 0 }
    d.exercises += s.graded
    d.correct += s.firstTry
    d.timeMs += s.timeMs
    await db.learnDaily.put(d)
  }

  if (session === undefined) return <div className="page center" />
  if (session === null) {
    return (
      <div className="page center">
        <p className="muted">
          nothing to review in {langName(lang)} yet — read and learn to build your word bank.{' '}
          <a href="#/learn">back</a>
        </p>
      </div>
    )
  }

  const glossSrc: GlossSource = {
    lang: session.lang,
    model: settings.model,
    apiKey: settings.openaiKey,
  }

  return (
    <LessonPlayer
      items={session.items}
      dir={session.dir}
      lang={session.lang}
      baseLang="en"
      glossSrc={glossSrc}
      unitTitle="review"
      reviewWords={session.reviewWords}
      recordOrigin={{ channel: 'learn' }}
      onFinish={onFinish}
      headline="review done"
    />
  )
}
