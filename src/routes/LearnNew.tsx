import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/schema'
import { useLanguages } from '../db/languages'
import { buildGeneratorPrompt, buildKnownWordsBlock, languageContextSummary } from '../learn/generatorPrompt'
import { knownWords } from '../vocab/bank'
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

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <>
      <Button onClick={copy}>{copied ? 'copied ✓' : label}</Button>
      <pre className="prompt-box">{text}</pre>
    </>
  )
}

/** Generation is per-language: the prompt describes every course/unit/lesson
 *  that already exists in the language, so the AI can extend or create as it
 *  sees fit. `courseId` (from "add lessons") just pre-selects that language. */
export default function LearnNew({ courseId }: { courseId?: string }) {
  const openedCourse = useLiveQuery(
    () => (courseId ? db.learnCourses.get(courseId) : undefined),
    [courseId],
  )
  const allCourses = useLiveQuery(() => db.learnCourses.toArray(), [])
  const allUnits = useLiveQuery(() => db.learnUnits.toArray(), [])
  const allLessons = useLiveQuery(() => db.learnLessons.toArray(), [])

  const { active } = useLanguages()
  const [newTarget, setNewTarget] = useState('fa')
  const [touchedTarget, setTouchedTarget] = useState(false)
  const [newBase, setNewBase] = useState('en')
  // default the target to the active language (until the user picks another)
  useEffect(() => {
    if (active && !touchedTarget && !courseId) setNewTarget(active)
  }, [active, touchedTarget, courseId])

  // the language we're authoring for: the opened course's, or the selected one
  const targetLang = openedCourse?.targetLang ?? newTarget

  const coursesInLang = useMemo(
    () => (allCourses ?? []).filter((c) => c.targetLang === targetLang),
    [allCourses, targetLang],
  )
  const baseLang = openedCourse?.baseLang ?? coursesInLang[0]?.baseLang ?? newBase
  const firstInLang = coursesInLang.length === 0

  const known = useLiveQuery(() => knownWords(targetLang), [targetLang])

  const prompt = useMemo(() => {
    const ctx = languageContextSummary(
      coursesInLang.map((c) => ({ id: c.id, title: c.title })),
      (cid) => (allUnits ?? []).filter((u) => u.courseId === cid),
      (uid) => (allLessons ?? []).filter((l) => l.unitId === uid).length,
    )
    return buildGeneratorPrompt({
      targetLang,
      baseLang,
      languageContext: ctx,
      hasKnownWords: (known?.length ?? 0) > 0,
    })
  }, [coursesInLang, allUnits, allLessons, targetLang, baseLang, known])

  const knownBlock = useMemo(
    () => buildKnownWordsBlock((known ?? []).map((w) => ({ surface: w.surface ?? w.lemma, gloss: w.gloss! }))),
    [known],
  )

  const langName = (c: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(c) ?? c

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/learn" aria-label="Back">
          ‹
        </a>
        <h1>{courseId ? 'add lessons' : 'new content'}</h1>
      </header>
      <main className="settings-main">
        <section className="section">
          <h2>1 · language</h2>
          {openedCourse ? (
            <p className="note">
              authoring for <b>{langName(targetLang)}</b>. the prompt below already knows every course,
              unit and lesson you have in this language — the AI can extend one or start a new course.
            </p>
          ) : (
            <>
              <div className="field">
                <label>language to learn</label>
                <select value={newTarget} onChange={(e) => { setTouchedTarget(true); setNewTarget(e.target.value) }}>
                  {TARGETS.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {firstInLang ? (
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
              ) : (
                <p className="note">
                  you already have {coursesInLang.length} course{coursesInLang.length > 1 ? 's' : ''} in{' '}
                  {langName(targetLang)} — the prompt lists them so the AI can extend or add a new one.
                </p>
              )}
            </>
          )}
        </section>

        <section className="section">
          <h2>2 · copy the prompt → your AI</h2>
          <p className="note">
            paste this into ChatGPT or Claude, then paste your source content where it says PASTE. the AI
            will ask a few questions, then return JSON.
          </p>
          <CopyBlock label="copy prompt" text={prompt} />
        </section>

        {knownBlock && (
          <section className="section">
            <h2>3 · paste your known words too</h2>
            <p className="note">
              paste this alongside the prompt so new lessons <b>recycle</b> the {known?.length} words you
              already know and add only a few new ones.
            </p>
            <CopyBlock label="copy known words" text={knownBlock} />
          </section>
        )}

        <section className="section">
          <h2>{knownBlock ? '4' : '3'} · import the file</h2>
          <p className="note">
            save the AI's reply as a <b>.json</b> file (or several as a <b>.zip</b>) and import it from the
            Learn home with <b>+ import unit</b>. it merges into your courses.
          </p>
        </section>
        <Rule style={{ opacity: 0 }} />
      </main>
    </div>
  )
}
