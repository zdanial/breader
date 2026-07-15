import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, type LessonItem, type VocabOrigin } from '../db/schema'
import { updateSettings, useSettings } from '../db/settings'
import { GlossChip } from '../learn/GlossChip'
import type { GlossSource } from '../learn/gloss'
import { segmentParagraph } from '../segment/registry'
import { PassageReader } from '../reader/PassageReader'
import { navigate } from '../router'
import { SpeakerIcon } from '../tts/SpeakerButton'
import { useSpeak } from '../tts/useSpeak'
import { recordResult, learnGrade } from '../vocab/bank'
import { Button } from '../ui'

const arraysEqual = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const todayKey = () => new Date().toISOString().slice(0, 10)

// deterministic-enough shuffle for the match column (app runtime; Math.random ok)
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type Phase = 'answering' | 'correct' | 'wrong'

export interface LessonSummary {
  firstTry: number
  graded: number
  mistakes: number
  timeMs: number
  words: string[]
}

// ── data wrapper: loads an authored lesson and persists progress ──────────────

export default function Lesson({ lessonId }: { lessonId: string }) {
  // null (not undefined) once resolved-but-missing, so we can tell "loading"
  // from "not found" — Dexie returns undefined for both otherwise.
  const lesson = useLiveQuery(() => db.learnLessons.get(lessonId).then((l) => l ?? null), [lessonId])
  const course = useLiveQuery(
    () => (lesson ? db.learnCourses.get(lesson.courseId) : undefined),
    [lesson],
  )
  const unit = useLiveQuery(() => (lesson ? db.learnUnits.get(lesson.unitId) : undefined), [lesson])
  const settings = useSettings()

  // persist progress + stats when the lesson completes
  const onFinish = useCallback(
    async (s: LessonSummary) => {
      if (!lesson || !course) return
      const accuracy = s.graded > 0 ? s.firstTry / s.graded : 1
      const prev = await db.learnProgress.get(lessonId)
      await db.learnProgress.put({
        lessonId,
        courseId: lesson.courseId,
        unitId: lesson.unitId,
        completed: true,
        bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, accuracy),
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: Date.now(),
      })
      const stats = (await db.learnStats.get('singleton')) ?? {
        id: 'singleton' as const,
        totalExercises: 0,
        totalCorrect: 0,
        totalTimeMs: 0,
        activeDays: [],
      }
      stats.totalExercises += s.graded
      stats.totalCorrect += s.firstTry
      stats.totalTimeMs += s.timeMs
      const day = todayKey()
      if (!stats.activeDays.includes(day)) stats.activeDays.push(day)
      await db.learnStats.put(stats)

      // per-language/day rollup for over-time + by-language stats
      const lang = course.targetLang
      const did = `${lang}:${day}`
      const d = (await db.learnDaily.get(did)) ?? { id: did, lang, day, exercises: 0, correct: 0, timeMs: 0 }
      d.exercises += s.graded
      d.correct += s.firstTry
      d.timeMs += s.timeMs
      await db.learnDaily.put(d)
    },
    [lesson, course, lessonId],
  )

  if (lesson === undefined) return <div className="page center" />
  if (!lesson || !course) {
    return (
      <div className="page center">
        <p className="muted">
          lesson not found. <a href="#/learn">back</a>
        </p>
      </div>
    )
  }

  const glossSrc: GlossSource = {
    glossary: unit?.glossary,
    lang: course.targetLang,
    model: settings.model,
    apiKey: settings.openaiKey,
  }

  return (
    <LessonPlayer
      items={lesson.items}
      dir={course.dir}
      lang={course.targetLang}
      baseLang={course.baseLang}
      glossSrc={glossSrc}
      unitTitle={unit?.title}
      recordOrigin={{ channel: 'learn', courseId: lesson.courseId, unitId: lesson.unitId }}
      onFinish={onFinish}
    />
  )
}

// ── the player: runs any LessonItem[] (authored lesson OR review session) ──────

export function LessonPlayer({
  items,
  dir,
  lang,
  baseLang,
  glossSrc,
  unitTitle,
  reviewWords,
  recordOrigin,
  onFinish,
  headline,
}: {
  items: LessonItem[]
  dir: 'ltr' | 'rtl'
  lang: string
  baseLang: string
  glossSrc: GlossSource
  unitTitle?: string
  // review mode: the vocab word each item reviews (by item index). Its presence
  // makes grading record these words instead of the type-derived target words.
  reviewWords?: Array<string | undefined>
  recordOrigin?: VocabOrigin
  onFinish: (s: LessonSummary) => void
  headline?: string // celebration title override (e.g. "review done")
}) {
  const settings = useSettings()
  const scale = settings.fontScale
  const gradedCount = useMemo(
    () => items.filter((i) => i.type !== 'teach' && i.type !== 'read').length,
    [items],
  )

  // queue of item indices; wrong graded items get re-queued to the end
  const [queue, setQueue] = useState<number[]>([])
  const [qpos, setQpos] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const everWrong = useRef<Set<number>>(new Set())
  const firstTry = useRef(0)
  const mistakes = useRef(0)
  const wordsSeen = useRef<Set<string>>(new Set())
  const startedAt = useRef(Date.now())
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (items.length && queue.length === 0) {
      setQueue(items.map((_, i) => i))
      startedAt.current = Date.now()
    }
  }, [items, queue.length])

  const itemIndex = queue[qpos]
  const item: LessonItem | undefined = itemIndex != null ? items[itemIndex] : undefined

  // per-item answer state, reset on move
  const [phase, setPhase] = useState<Phase>('answering')
  const [choiceSel, setChoiceSel] = useState<number | null>(null)
  const [built, setBuilt] = useState<number[]>([])
  const [matchDone, setMatchDone] = useState(0) // pairs confirmed so far (for footer count)
  const resetItem = useCallback(() => {
    setPhase('answering')
    setChoiceSel(null)
    setBuilt([])
    setMatchDone(0)
  }, [])
  useEffect(resetItem, [qpos, resetItem])

  const [gloss, setGloss] = useState<{ word: string; rect: DOMRect } | null>(null)

  const finish = useCallback(() => {
    setCompleted(true)
    onFinish({
      firstTry: firstTry.current,
      graded: gradedCount,
      mistakes: mistakes.current,
      timeMs: Date.now() - startedAt.current,
      words: [...wordsSeen.current],
    })
  }, [gradedCount, onFinish])

  const advance = useCallback(() => {
    const next = qpos + 1
    if (next >= queue.length) finish()
    else setQpos(next)
  }, [qpos, queue.length, finish])

  const markDone = useCallback((idx: number) => {
    setDone((d) => new Set(d).add(idx))
  }, [])

  const grade = useCallback(
    (correct: boolean, targetWords: string[]) => {
      if (itemIndex == null) return
      const wasRequeued = everWrong.current.has(itemIndex)
      const g = learnGrade(correct, wasRequeued)
      // review mode records the item's reviewed word; authored lessons record
      // the type-derived target words
      const rw = reviewWords?.[itemIndex]
      const toRecord = reviewWords ? (rw ? [rw] : []) : targetWords
      for (const w of toRecord) {
        wordsSeen.current.add(w.toLowerCase())
        void recordResult({ lang, word: w, grade: g, origin: recordOrigin })
      }
      if (correct) {
        if (!wasRequeued) firstTry.current += 1
        markDone(itemIndex)
        setPhase('correct')
      } else {
        mistakes.current += 1
        everWrong.current.add(itemIndex)
        setQueue((q) => [...q, itemIndex]) // re-queue
        setPhase('wrong')
      }
    },
    [itemIndex, markDone, lang, reviewWords, recordOrigin],
  )

  if (completed) {
    const accuracy = gradedCount > 0 ? Math.round((firstTry.current / gradedCount) * 100) : 100
    // "lilac break" — the results view forces the light palette even in dark mode
    return (
      <div className="page center celebrate lilac-break" data-theme="light">
        <div className="celebrate-inner">
          <div className="celebrate-title">{headline ?? 'well done'}</div>
          <span className="rule res-rule" />
          <div className="celebrate-stats">
            <div>
              <span className="cn">{accuracy}%</span>
              <span className="cl">accuracy</span>
            </div>
            <div>
              <span className="cn">{wordsSeen.current.size}</span>
              <span className="cl">words</span>
            </div>
          </div>
          <div className="res-triad" aria-hidden>
            <span style={{ background: 'var(--accent)' }} />
            <span style={{ background: 'var(--danger)' }} />
            <span style={{ background: 'var(--signal-green)' }} />
          </div>
          <Button onClick={() => navigate('/learn')} style={{ marginTop: 26 }}>
            done
          </Button>
        </div>
      </div>
    )
  }

  const openGloss = (word: string, e: React.PointerEvent | React.MouseEvent) =>
    setGloss({ word, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })

  // eyebrow/numeral label: build/listen → "build the phrase", match → "match the
  // pairs", everything else → the unit title. Uppercased in CSS.
  const qLabel =
    item?.type === 'build' || item?.type === 'listen'
      ? 'build the phrase'
      : item?.type === 'match'
        ? 'match the pairs'
        : (unitTitle ?? '')
  // question number within the lesson: 1-based position among the lesson's items
  const qNum = itemIndex != null ? itemIndex + 1 : 1
  const showQHead = item != null && item.type !== 'read'

  return (
    <div className="page lesson" style={{ ['--font-scale' as string]: scale } as React.CSSProperties}>
      <header className="topbar lesson-top">
        <a className="icon-btn" href="#/learn" aria-label="Quit lesson">
          ✕
        </a>
        <SegmentedLedger count={items.length} done={done} current={itemIndex} />
        <button
          className="font-btn"
          aria-label="Smaller text"
          onClick={() => updateSettings({ fontScale: Math.max(0.4, +(scale - 0.1).toFixed(2)) })}
        >
          A−
        </button>
        <button
          className="font-btn"
          aria-label="Larger text"
          onClick={() => updateSettings({ fontScale: Math.min(1.8, +(scale + 0.1).toFixed(2)) })}
        >
          A+
        </button>
      </header>

      {item?.type === 'read' ? (
        <ReadView
          key={itemIndex}
          item={item}
          dir={dir}
          lang={lang}
          baseLang={baseLang}
          glossSrc={glossSrc}
          onDone={() => {
            markDone(itemIndex!)
            advance()
          }}
        />
      ) : (
        <>
      <main className="lesson-body">
        {showQHead && <QuestionHead n={qNum} label={qLabel} />}
        {item?.type === 'teach' && (
          <TeachView item={item} dir={dir} onGloss={openGloss} />
        )}
        {item?.type === 'choice' && (
          <ChoiceView
            item={item}
            dir={dir}
            phase={phase}
            selected={choiceSel}
            onSelect={setChoiceSel}
            onGloss={openGloss}
          />
        )}
        {item?.type === 'blank' && (
          <BlankView
            item={item}
            dir={dir}
            phase={phase}
            selected={choiceSel}
            onSelect={setChoiceSel}
            onGloss={openGloss}
          />
        )}
        {item?.type === 'build' && (
          <BuildView item={item} dir={dir} phase={phase} built={built} setBuilt={setBuilt} onGloss={openGloss} />
        )}
        {item?.type === 'listen' && (
          <ListenView key={itemIndex} item={item} dir={dir} phase={phase} built={built} setBuilt={setBuilt} onGloss={openGloss} />
        )}
        {item?.type === 'match' && (
          <MatchView
            key={itemIndex}
            item={item}
            dir={dir}
            lang={lang}
            onComplete={() => {
              markDone(itemIndex!)
              if (!everWrong.current.has(itemIndex!)) firstTry.current += 1
              setPhase('correct')
            }}
            onMistake={() => (mistakes.current += 1)}
            onProgress={setMatchDone}
            onGloss={openGloss}
          />
        )}
      </main>

      {/* Once answered, the check button is replaced by a feedback ledger strip
          that rises from the bottom. teach/match keep the plain footer. */}
      {(item?.type === 'choice' ||
        item?.type === 'blank' ||
        item?.type === 'build' ||
        item?.type === 'listen') &&
      phase !== 'answering' ? (
        <FeedbackStrip
          phase={phase}
          dir={dir}
          headword={feedbackHeadword(item)}
          note={item.note}
          onNext={advance}
        />
      ) : (
        <footer className="lesson-foot">
          {item?.type === 'teach' && (
            <Button onClick={() => { markDone(itemIndex!); advance() }} style={{ width: '100%' }}>
              continue
            </Button>
          )}
          {(item?.type === 'choice' || item?.type === 'blank') && (
            <Button
              variant={choiceSel == null ? 'secondary' : 'primary'}
              disabled={choiceSel == null}
              onClick={() => {
                const target = item.choices[item.answer]
                grade(choiceSel === item.answer, item.type === 'blank' ? [target] : [])
              }}
              style={{ width: '100%' }}
            >
              check
            </Button>
          )}
          {(item?.type === 'build' || item?.type === 'listen') && (
            <Button
              variant={built.length === 0 ? 'secondary' : 'primary'}
              disabled={built.length === 0}
              onClick={() => {
                const words = built.map((i) => item.tiles[i])
                const ok = arraysEqual(words, item.answer) || !!item.accept?.some((a) => arraysEqual(words, a))
                grade(ok, item.answer)
              }}
              style={{ width: '100%' }}
            >
              check
            </Button>
          )}
          {item?.type === 'match' &&
            (phase === 'correct' ? (
              <Button onClick={advance} style={{ width: '100%' }}>continue</Button>
            ) : (
              <div className="match-count">
                {matchDone} of {item.pairs.length} matched
              </div>
            ))}
        </footer>
      )}
        </>
      )}

      {gloss && (
        <GlossChip word={gloss.word} anchor={gloss.rect} src={glossSrc} onClose={() => setGloss(null)} />
      )}
    </div>
  )
}

// ── item views ───────────────────────────────────────────────────────────────

type GlossFn = (word: string, e: React.PointerEvent | React.MouseEvent) => void

// Segmented progress ledger — one tick per item in the lesson. Completed ticks
// are filled, the current tick is accent-blue, the rest are faint.
function SegmentedLedger({
  count, done, current,
}: {
  count: number; done: Set<number>; current: number | undefined
}) {
  return (
    <div className="ledger" role="progressbar" aria-valuemin={0} aria-valuemax={count} aria-valuenow={done.size}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`seg${done.has(i) ? ' done' : ''}${i === current ? ' cur' : ''}`} />
      ))}
    </div>
  )
}

// Question header — lowercase eyebrow (question nn · label), an oversized serif
// numeral anchored top-right, and the signature 3px rule beneath.
function QuestionHead({ n, label }: { n: number; label: string }) {
  const nn = String(n).padStart(2, '0')
  return (
    <div className="q-head">
      <div className="q-head-row">
        <span className="q-eyebrow">question {nn}{label ? ` · ${label}` : ''}</span>
        <span className="q-numeral">{nn}</span>
      </div>
      <span className="rule" />
    </div>
  )
}

// The target headword surfaced in the feedback strip after answering.
function feedbackHeadword(item: LessonItem): string {
  if (item.type === 'choice' || item.type === 'blank') return item.choices[item.answer]
  if (item.type === 'build' || item.type === 'listen') return item.answer.join(' ')
  return ''
}

// Feedback ledger strip that rises from the bottom, replacing the check button.
// Correct → green top rule + "correct"; wrong → red top rule + "not quite".
function FeedbackStrip({
  phase, dir, headword, note, onNext,
}: {
  phase: Phase; dir: 'ltr' | 'rtl'; headword: string; note?: string; onNext: () => void
}) {
  const correct = phase === 'correct'
  return (
    <div className={`fb-strip ${phase}`}>
      <div className="fb-body">
        <div className="fb-text">
          <span className="fb-label">{correct ? 'correct' : 'not quite'}</span>
          {/* TODO: transliteration once in schema */}
          <span className="fb-headword" dir={dir}>{headword}</span>
          {note && <span className="fb-why">{note}</span>}
        </div>
        <Button className={`fb-btn ${correct ? 'ok' : ''}`.trim()} onClick={onNext}>
          {correct ? 'continue →' : 'got it →'}
        </Button>
      </div>
    </div>
  )
}

// Writing sample (poem/story) read with the shared PassageReader — sentence at a
// time, tap words for gloss, hold to peek the translation, speaker audio.
function ReadView({
  item, dir, lang, baseLang, glossSrc, onDone,
}: {
  item: Extract<LessonItem, { type: 'read' }>
  dir: 'ltr' | 'rtl'; lang: string; baseLang: string; glossSrc: GlossSource; onDone: () => void
}) {
  // one line/stanza per newline, then sentence-split each — pairs target ↔ base
  const seg = (text: string, l: string) =>
    text
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => segmentParagraph(s, l))
  const sentences = seg(item.text, lang)
  const translations = item.translation ? seg(item.translation, baseLang) : undefined
  return (
    <>
      {item.title && <h2 className="read-title" dir="auto">{item.title}</h2>}
      <PassageReader
        sentences={sentences}
        translations={translations}
        dir={dir}
        lang={lang}
        glossSrc={glossSrc}
        onDone={onDone}
      />
    </>
  )
}

function TeachView({ item, dir, onGloss }: { item: Extract<LessonItem, { type: 'teach' }>; dir: 'ltr' | 'rtl'; onGloss: GlossFn }) {
  return (
    <div className="teach">
      <h2 className="teach-title">{item.title}</h2>
      <p className="teach-body">{item.body}</p>
      {item.examples && (
        <div className="teach-examples">
          {item.examples.map(([t, b], i) => (
            <div key={i} className="teach-ex">
              <span className="tgt" dir={dir} onClick={(e) => onGloss(t, e)}>
                {t}
              </span>
              <span className="base">{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ChoiceView({
  item, dir, phase, selected, onSelect, onGloss,
}: {
  item: Extract<LessonItem, { type: 'choice' }>
  dir: 'ltr' | 'rtl'; phase: Phase; selected: number | null
  onSelect: (i: number) => void; onGloss: GlossFn
}) {
  return (
    <div className="ex">
      <p className="ex-prompt">{item.prompt}</p>
      <div className="choices">
        {item.choices.map((c, i) => (
          <ChoiceTile
            key={i}
            text={c}
            dir={dir}
            state={
              phase !== 'answering' && i === item.answer
                ? 'correct'
                : phase === 'wrong' && i === selected
                  ? 'wrong'
                  : i === selected
                    ? 'selected'
                    : 'idle'
            }
            reveal={phase === 'wrong' && i === item.answer}
            disabled={phase !== 'answering'}
            onSelect={() => onSelect(i)}
            onGloss={onGloss}
          />
        ))}
      </div>
    </div>
  )
}

function BlankView({
  item, dir, phase, selected, onSelect, onGloss,
}: {
  item: Extract<LessonItem, { type: 'blank' }>
  dir: 'ltr' | 'rtl'; phase: Phase; selected: number | null
  onSelect: (i: number) => void; onGloss: GlossFn
}) {
  return (
    <div className="ex">
      <p className="ex-prompt tgt-prompt" dir={dir}>{item.prompt}</p>
      {item.translation && <p className="ex-sub">{item.translation}</p>}
      <div className="choices">
        {item.choices.map((c, i) => (
          <ChoiceTile
            key={i}
            text={c}
            dir={dir}
            state={
              phase !== 'answering' && i === item.answer
                ? 'correct'
                : phase === 'wrong' && i === selected
                  ? 'wrong'
                  : i === selected
                    ? 'selected'
                    : 'idle'
            }
            reveal={phase === 'wrong' && i === item.answer}
            disabled={phase !== 'answering'}
            onSelect={() => onSelect(i)}
            onGloss={onGloss}
          />
        ))}
      </div>
    </div>
  )
}

function BuildBody({
  tiles, dir, phase, built, setBuilt, onGloss,
}: {
  tiles: string[]; dir: 'ltr' | 'rtl'; phase: Phase; built: number[]
  setBuilt: (f: (b: number[]) => number[]) => void; onGloss: GlossFn
}) {
  const used = new Set(built)
  return (
    <>
      {/* dotted-leader baseline — the reader's ledger motif; chips land in order,
          an empty caret slot marks where the next word goes */}
      <div className="build-answer ledger-line" dir={dir}>
        {built.map((ti, pos) => (
          <button key={pos} className="tile" dir={dir} disabled={phase !== 'answering'}
            onClick={() => setBuilt((b) => b.filter((_, p) => p !== pos))}>
            {tiles[ti]}
          </button>
        ))}
        {phase === 'answering' && <span className="caret-slot" aria-hidden />}
      </div>
      <div className="bank-label">word bank</div>
      <div className="build-bank" dir={dir}>
        {tiles.map((t, i) =>
          used.has(i) ? (
            <span key={i} className="tile ghost">{t}</span>
          ) : (
            <BankTile key={i} text={t} dir={dir} disabled={phase !== 'answering'}
              onSelect={() => setBuilt((b) => [...b, i])} onGloss={onGloss} />
          ),
        )}
      </div>
    </>
  )
}

function BuildView({
  item, dir, phase, built, setBuilt, onGloss,
}: {
  item: Extract<LessonItem, { type: 'build' }>
  dir: 'ltr' | 'rtl'; phase: Phase; built: number[]
  setBuilt: (f: (b: number[]) => number[]) => void; onGloss: GlossFn
}) {
  return (
    <div className="ex">
      <p className="ex-prompt">{item.prompt}</p>
      <BuildBody tiles={item.tiles} dir={dir} phase={phase} built={built} setBuilt={setBuilt} onGloss={onGloss} />
    </div>
  )
}

function ListenView({
  item, dir, phase, built, setBuilt, onGloss,
}: {
  item: Extract<LessonItem, { type: 'listen' }>
  dir: 'ltr' | 'rtl'; phase: Phase; built: number[]
  setBuilt: (f: (b: number[]) => number[]) => void; onGloss: GlossFn
}) {
  const { say, hasKey } = useSpeak()
  // autoplay once on mount (rides the tap that entered this item — a user gesture)
  useEffect(() => {
    if (hasKey) say(item.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.text])
  return (
    <div className="ex">
      <p className="ex-prompt">tap what you hear</p>
      <button className="listen-play" onClick={() => say(item.text)} disabled={!hasKey}>
        <SpeakerIcon size={18} /> {hasKey ? 'play again' : 'add a key in settings for audio'}
      </button>
      {phase !== 'answering' && item.translation && <p className="ex-sub" dir={dir}>{item.text}</p>}
      <BuildBody tiles={item.tiles} dir={dir} phase={phase} built={built} setBuilt={setBuilt} onGloss={onGloss} />
    </div>
  )
}

function MatchView({
  item, dir, lang, onComplete, onMistake, onProgress, onGloss,
}: {
  item: Extract<LessonItem, { type: 'match' }>
  dir: 'ltr' | 'rtl'; lang: string; onComplete: () => void; onMistake: () => void
  onProgress: (n: number) => void; onGloss: GlossFn
}) {
  const targets = item.pairs.map((p, i) => ({ text: p[0], i }))
  const bases = useMemo(() => shuffled(item.pairs.map((p, i) => ({ text: p[1], i }))), [item])
  const [sel, setSel] = useState<number | null>(null)
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const [wrong, setWrong] = useState<number | null>(null)

  useEffect(() => { onProgress(matched.size) }, [matched, onProgress])

  const pick = (side: 't' | 'b', i: number) => {
    if (matched.has(i)) return
    if (side === 't') { setSel(i); return }
    if (sel == null) return
    if (sel === i) {
      const m = new Set(matched).add(i)
      setMatched(m)
      setSel(null)
      if (lang) void recordResult({ lang, word: item.pairs[i][0], grade: 2 })
      if (m.size === item.pairs.length) onComplete()
    } else {
      onMistake()
      setWrong(i)
      setTimeout(() => setWrong(null), 350)
      setSel(null)
    }
  }

  const selText = sel != null ? item.pairs[sel][0] : null

  return (
    <div className="ex match-ex">
      {/* confirmed pairs collapse into dimmed ledger rows and move up out of the way */}
      {matched.size > 0 && (
        <div className="match-confirmed">
          {item.pairs.map((p, i) =>
            matched.has(i) ? (
              <div key={i} className="match-row">
                <span className="match-tick" aria-hidden />
                <span className="mr-tgt" dir={dir}>{p[0]}</span>
                <span className="mr-arrow" aria-hidden>→</span>
                <span className="mr-base">{p[1]}</span>
              </div>
            ) : null,
          )}
        </div>
      )}

      <p className="match-hint">
        {selText ? (
          <>now pick the English for <b dir={dir}>{selText}</b></>
        ) : (
          'tap a word, then its english match'
        )}
      </p>

      <div className="match">
        <div className="match-col">
          {targets
            .filter((t) => !matched.has(t.i))
            .map((t) => (
              <button key={t.i}
                className={`tile ${sel === t.i ? 'ring' : ''}`.trim()}
                onClick={() => pick('t', t.i)}
                onContextMenu={(e) => { e.preventDefault(); onGloss(t.text, e) }}>
                <span dir={dir}>{t.text}</span>
              </button>
            ))}
        </div>
        <div className="match-col">
          {bases
            .filter((b) => !matched.has(b.i))
            .map((b) => (
              <button key={b.i}
                className={`tile ${wrong === b.i ? 'shake wrong' : ''}`.trim()}
                onClick={() => pick('b', b.i)}>
                {b.text}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

// ── tiles (with long-press gloss) ────────────────────────────────────────────

function useLongPress(onLong: (e: React.PointerEvent) => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const long = useRef(false)
  return {
    onPointerDown: (e: React.PointerEvent) => {
      long.current = false
      if (!enabled) return
      const ev = e
      timer.current = setTimeout(() => { long.current = true; onLong(ev) }, 350)
    },
    onPointerUp: () => { if (timer.current) clearTimeout(timer.current) },
    onPointerLeave: () => { if (timer.current) clearTimeout(timer.current) },
    suppressed: () => long.current,
  }
}

function ChoiceTile({
  text, dir, state, disabled, reveal, onSelect, onGloss,
}: {
  text: string; dir: 'ltr' | 'rtl'; state: 'idle' | 'selected' | 'correct' | 'wrong'
  disabled: boolean; reveal?: boolean; onSelect: () => void; onGloss: GlossFn
}) {
  const lp = useLongPress((e) => onGloss(text, e), true)
  return (
    <button
      className={`choice-tile ${state}`}
      disabled={disabled}
      onPointerDown={lp.onPointerDown}
      onPointerUp={lp.onPointerUp}
      onPointerLeave={lp.onPointerLeave}
      onClick={() => { if (!lp.suppressed()) onSelect() }}
    >
      {/* signal bar pinned left (stays left in RTL, as the lesson-home rows do) */}
      <span className="sig" aria-hidden />
      <span className="choice-text" dir={dir}>{text}</span>
      {reveal && <span className="choice-tag">correct</span>}
    </button>
  )
}

function BankTile({ text, dir, disabled, onSelect, onGloss }: { text: string; dir: 'ltr' | 'rtl'; disabled: boolean; onSelect: () => void; onGloss: GlossFn }) {
  const lp = useLongPress((e) => onGloss(text, e), true)
  return (
    <button className="tile" dir={dir} disabled={disabled}
      onPointerDown={lp.onPointerDown} onPointerUp={lp.onPointerUp} onPointerLeave={lp.onPointerLeave}
      onClick={() => { if (!lp.suppressed()) onSelect() }}>
      {text}
    </button>
  )
}
