import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, type LessonItem } from '../db/schema'
import { useSettings } from '../db/settings'
import { GlossChip } from '../learn/GlossChip'
import type { GlossSource } from '../learn/gloss'
import { segmentParagraph } from '../segment/registry'
import { PassageReader } from '../reader/PassageReader'
import { navigate } from '../router'
import { SpeakerIcon } from '../tts/SpeakerButton'
import { useSpeak } from '../tts/useSpeak'
import { recordEncounter } from '../vocab/bank'
import { Button, ProgressBar } from '../ui'

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

export default function Lesson({ lessonId }: { lessonId: string }) {
  const lesson = useLiveQuery(() => db.learnLessons.get(lessonId), [lessonId])
  const course = useLiveQuery(
    () => (lesson ? db.learnCourses.get(lesson.courseId) : undefined),
    [lesson],
  )
  const unit = useLiveQuery(() => (lesson ? db.learnUnits.get(lesson.unitId) : undefined), [lesson])
  const settings = useSettings()

  const items = lesson?.items ?? []
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
    if (lesson && queue.length === 0) {
      setQueue(items.map((_, i) => i))
      startedAt.current = Date.now()
    }
  }, [lesson, items, queue.length])

  const itemIndex = queue[qpos]
  const item: LessonItem | undefined = itemIndex != null ? items[itemIndex] : undefined

  // per-item answer state, reset on move
  const [phase, setPhase] = useState<Phase>('answering')
  const [choiceSel, setChoiceSel] = useState<number | null>(null)
  const [built, setBuilt] = useState<number[]>([])
  const resetItem = useCallback(() => {
    setPhase('answering')
    setChoiceSel(null)
    setBuilt([])
  }, [])
  useEffect(resetItem, [qpos, resetItem])

  const glossSrc: GlossSource = {
    glossary: unit?.glossary,
    lang: course?.targetLang ?? 'en',
    model: settings.model,
    apiKey: settings.openaiKey,
  }
  const [gloss, setGloss] = useState<{ word: string; rect: DOMRect } | null>(null)

  const finish = useCallback(async () => {
    setCompleted(true)
    const accuracy = gradedCount > 0 ? firstTry.current / gradedCount : 1
    const xp = 10 + firstTry.current
    if (!lesson) return
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
      xp: 0,
      totalExercises: 0,
      totalCorrect: 0,
      totalTimeMs: 0,
      activeDays: [],
    }
    stats.xp += xp
    stats.totalExercises += gradedCount
    stats.totalCorrect += firstTry.current
    stats.totalTimeMs += Date.now() - startedAt.current
    const day = todayKey()
    if (!stats.activeDays.includes(day)) stats.activeDays.push(day)
    await db.learnStats.put(stats)

    // per-language/day rollup for over-time + by-language stats
    const lang = course?.targetLang ?? lesson.courseId
    const did = `${lang}:${day}`
    const d = (await db.learnDaily.get(did)) ?? { id: did, lang, day, xp: 0, exercises: 0, correct: 0, timeMs: 0 }
    d.xp += xp
    d.exercises += gradedCount
    d.correct += firstTry.current
    d.timeMs += Date.now() - startedAt.current
    await db.learnDaily.put(d)
  }, [gradedCount, lesson, lessonId, course])

  const advance = useCallback(() => {
    const next = qpos + 1
    if (next >= queue.length) void finish()
    else setQpos(next)
  }, [qpos, queue.length, finish])

  const markDone = useCallback((idx: number) => {
    setDone((d) => new Set(d).add(idx))
  }, [])

  // record target words into the shared word bank
  const recordWords = useCallback(
    (words: string[], correct: boolean) => {
      const lang = course?.targetLang
      if (!lang) return
      for (const w of words) {
        wordsSeen.current.add(w.toLowerCase())
        void recordEncounter({ lang, word: w, source: 'learn', correct })
      }
    },
    [course],
  )

  const grade = useCallback(
    (correct: boolean, targetWords: string[]) => {
      if (itemIndex == null) return
      recordWords(targetWords, correct)
      if (correct) {
        if (!everWrong.current.has(itemIndex)) firstTry.current += 1
        markDone(itemIndex)
        setPhase('correct')
      } else {
        mistakes.current += 1
        everWrong.current.add(itemIndex)
        setQueue((q) => [...q, itemIndex]) // re-queue
        setPhase('wrong')
      }
    },
    [itemIndex, markDone, recordWords],
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

  if (completed) {
    const accuracy = gradedCount > 0 ? Math.round((firstTry.current / gradedCount) * 100) : 100
    return (
      <div className="page center celebrate">
        <div className="celebrate-inner">
          <div className="celebrate-title">well done</div>
          <span className="rule" style={{ maxWidth: 220, margin: '18px auto' }} />
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
          <Button onClick={() => navigate('/learn')} style={{ marginTop: 24 }}>
            done
          </Button>
        </div>
      </div>
    )
  }

  const dir = course.dir
  const openGloss = (word: string, e: React.PointerEvent | React.MouseEvent) =>
    setGloss({ word, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })

  return (
    <div className="page lesson">
      <header className="topbar lesson-top">
        <a className="icon-btn" href="#/learn" aria-label="Quit lesson">
          ✕
        </a>
        <ProgressBar value={items.length ? done.size / items.length : 0} />
      </header>

      {item?.type === 'read' ? (
        <ReadView
          key={itemIndex}
          item={item}
          dir={dir}
          lang={course.targetLang}
          baseLang={course.baseLang}
          glossSrc={glossSrc}
          onDone={() => {
            markDone(itemIndex!)
            advance()
          }}
        />
      ) : (
        <>
      <main className="lesson-body">
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
            lang={course.targetLang}
            onComplete={() => {
              markDone(itemIndex!)
              if (!everWrong.current.has(itemIndex!)) firstTry.current += 1
              setPhase('correct')
            }}
            onMistake={() => (mistakes.current += 1)}
            onGloss={openGloss}
          />
        )}
      </main>

      {phase !== 'answering' && item?.type !== 'match' && (
        <FeedbackBanner phase={phase} item={item} dir={dir} />
      )}

      <footer className="lesson-foot">
        {item?.type === 'teach' && (
          <Button onClick={() => { markDone(itemIndex!); advance() }} style={{ width: '100%' }}>
            continue
          </Button>
        )}
        {(item?.type === 'choice' || item?.type === 'blank') &&
          (phase === 'answering' ? (
            <Button
              disabled={choiceSel == null}
              onClick={() => {
                const target = item.choices[item.answer]
                grade(choiceSel === item.answer, item.type === 'blank' ? [target] : [])
              }}
              style={{ width: '100%' }}
            >
              check
            </Button>
          ) : (
            <Button onClick={advance} style={{ width: '100%' }}>continue</Button>
          ))}
        {(item?.type === 'build' || item?.type === 'listen') &&
          (phase === 'answering' ? (
            <Button
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
          ) : (
            <Button onClick={advance} style={{ width: '100%' }}>continue</Button>
          ))}
        {item?.type === 'match' && phase === 'correct' && (
          <Button onClick={advance} style={{ width: '100%' }}>continue</Button>
        )}
      </footer>
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
              <span className="tgt" lang={dir === 'rtl' ? undefined : undefined} dir={dir} onClick={(e) => onGloss(t, e)}>
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
      <div className="build-answer" dir={dir}>
        {built.map((ti, pos) => (
          <button key={pos} className="tile" dir={dir} disabled={phase !== 'answering'}
            onClick={() => setBuilt((b) => b.filter((_, p) => p !== pos))}>
            {tiles[ti]}
          </button>
        ))}
      </div>
      <span className="rule" style={{ opacity: 0.4 }} />
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
  item, dir, lang, onComplete, onMistake, onGloss,
}: {
  item: Extract<LessonItem, { type: 'match' }>
  dir: 'ltr' | 'rtl'; lang: string; onComplete: () => void; onMistake: () => void; onGloss: GlossFn
}) {
  const targets = item.pairs.map((p, i) => ({ text: p[0], i }))
  const bases = useMemo(() => shuffled(item.pairs.map((p, i) => ({ text: p[1], i }))), [item])
  const [sel, setSel] = useState<number | null>(null)
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const [wrong, setWrong] = useState<number | null>(null)

  const pick = (side: 't' | 'b', i: number) => {
    if (matched.has(i)) return
    if (side === 't') { setSel(i); return }
    if (sel == null) return
    if (sel === i) {
      const m = new Set(matched).add(i)
      setMatched(m)
      setSel(null)
      if (lang) void recordEncounter({ lang, word: item.pairs[i][0], source: 'learn', correct: true })
      if (m.size === item.pairs.length) onComplete()
    } else {
      onMistake()
      setWrong(i)
      setTimeout(() => setWrong(null), 350)
      setSel(null)
    }
  }

  return (
    <div className="ex">
      <p className="ex-prompt">match the pairs</p>
      <div className="match">
        <div className="match-col">
          {targets.map((t) => (
            <button key={t.i} dir={dir}
              className={`tile ${matched.has(t.i) ? 'ghost' : ''} ${sel === t.i ? 'selected' : ''}`}
              disabled={matched.has(t.i)}
              onClick={() => pick('t', t.i)}
              onContextMenu={(e) => { e.preventDefault(); onGloss(t.text, e) }}>
              {t.text}
            </button>
          ))}
        </div>
        <div className="match-col">
          {bases.map((b) => (
            <button key={b.i}
              className={`tile ${matched.has(b.i) ? 'ghost' : ''} ${wrong === b.i ? 'shake wrong' : ''}`}
              disabled={matched.has(b.i)}
              onClick={() => pick('b', b.i)}>
              {b.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FeedbackBanner({ phase, item, dir }: { phase: Phase; item?: LessonItem; dir: 'ltr' | 'rtl' }) {
  let correct = ''
  if (phase === 'wrong' && item) {
    if (item.type === 'choice' || item.type === 'blank') correct = item.choices[item.answer]
    else if (item.type === 'build') correct = item.answer.join(' ')
  }
  return (
    <div className={`feedback ${phase}`}>
      {phase === 'correct' ? (
        <span>✓ correct</span>
      ) : (
        <span>
          answer: <b dir={dir}>{correct}</b>
        </span>
      )}
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
  text, dir, state, disabled, onSelect, onGloss,
}: {
  text: string; dir: 'ltr' | 'rtl'; state: 'idle' | 'selected' | 'correct' | 'wrong'
  disabled: boolean; onSelect: () => void; onGloss: GlossFn
}) {
  const lp = useLongPress((e) => onGloss(text, e), true)
  return (
    <button
      className={`choice-tile ${state}`}
      dir={dir}
      disabled={disabled}
      onPointerDown={lp.onPointerDown}
      onPointerUp={lp.onPointerUp}
      onPointerLeave={lp.onPointerLeave}
      onClick={() => { if (!lp.suppressed()) onSelect() }}
    >
      {text}
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
