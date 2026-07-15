// Builds the copyable prompt the user pastes into their own AI to author a
// course fragment. Context-aware: it embeds the course's current structure so
// the AI can extend existing units or add new ones, and it tells the AI to ask
// clarifying questions and decide the unit/lesson breakdown itself.

const langLabel = (code: string) =>
  `${new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code} (${code})`

const SCHEMA = `{
  "breaderLearn": 1,
  "course": { "id": "<stable-course-id>", "title": "...", "targetLang": "<code>", "baseLang": "<code>" },
  "units": [
    { "id": "<course>-u<N>", "index": <N>, "title": "...",
      "glossary": [ { "word": "<target word>", "gloss": "<base meaning>" } ],
      "lessons": [
        { "id": "<course>-u<N>-l<M>", "index": <M>, "title": "...",
          "items": [
            { "type": "teach", "title": "...", "body": "...", "examples": [["<target>", "<base>"]] },
            { "type": "choice", "prompt": "...", "choices": ["...","..."], "answer": 0 },
            { "type": "build", "prompt": "...", "tiles": ["...","..."], "answer": ["...","..."] },
            { "type": "match", "pairs": [["<target>","<base>"], ["<target>","<base>"]] },
            { "type": "blank", "prompt": "... ___ ...", "translation": "...", "choices": ["...","..."], "answer": 0 },
            { "type": "listen", "text": "<target sentence to speak>", "tiles": ["...","..."], "answer": ["...","..."], "translation": "..." },
            { "type": "read", "title": "...", "text": "<a short poem or story in the target language, newlines allowed>", "translation": "..." }
          ] } ] } ]
}`

const ITEM_UX = `How each item appears to the learner (write content that fits):
- "teach": a full-screen card (title + explanation + optional example pairs), no input — introduces a concept before drills.
- "choice": a question with tappable options; exactly one correct ("answer" = index). Distractors must be plausible.
- "build": the learner taps word tiles in order to build the target sentence; "tiles" = the correct words PLUS believable extra tiles; "answer" = the correct ordered words.
- "match": two columns the learner pairs (target ↔ base); 3–5 pairs.
- "blank": a sentence with a gap; the learner picks the word that fills it.
- "listen": the learner hears the target sentence "text" spoken aloud (text-to-speech) and rebuilds it from word tiles; "tiles" = the correct words PLUS distractor tiles, "answer" = the correct ordered words. Use short, clearly pronounceable target sentences.
- "read": a writing sample (a short poem or story) in the target language, shown in a reading view — the learner taps words for glosses, plays it aloud, and can reveal a "translation". No input. Use for immersion/context at the end of a unit. Keep it level-appropriate; newlines are allowed for poems.
Any target word is tappable for a gloss, so include a "glossary" for the vocabulary used.`

export function buildGeneratorPrompt(opts: {
  targetLang: string
  baseLang: string
  languageContext: string // a summary of every course/unit/lesson in this language
  hasKnownWords: boolean // whether a "known words" list is pasted alongside
}): string {
  return `You are authoring language-learning content for the "Learn" section of an app. When you are ready, output ONLY valid JSON — one fragment per course, matching this schema — but NOT yet:

${SCHEMA}

${ITEM_UX}

- Target language: ${langLabel(opts.targetLang)}. Base language: ${langLabel(opts.baseLang)}.
- What already exists in ${langLabel(opts.targetLang)}: ${opts.languageContext}
- Source material: <<< PASTE YOUR SOURCE CONTENT HERE >>>
${opts.hasKnownWords ? '- The learner\'s KNOWN WORDS are pasted separately below — read them.' : ''}

You decide the shape: extend an existing course (reuse its exact course.id and the ids/indices of the units you touch) OR create a new course with a new stable id like "${opts.targetLang}-<topic>". Output one JSON fragment per course you create or update; if several, I will save them together as a .zip.

WORKFLOW — three gated steps. Do NOT jump ahead to the JSON:
1. ASK — first, ask me clarifying questions to confirm scope: which existing course to extend vs. a new one, the level, how much of the source to cover, ordering, and anything ambiguous.
2. OUTLINE — after I answer, propose an OUTLINE in plain text (NOT JSON): the course(s), and for each unit its title, the NEW words it introduces (with glosses), and a one-line summary of each lesson showing how those words get drilled and recycled. Then ask me to APPROVE or adjust the outline.
3. GENERATE — ONLY after I approve the outline, output the JSON.
Decide the number of units and lessons yourself from the amount and nature of the content — no fixed count — but follow the DENSITY rules below.

DENSITY — build a LOT of practice, not a thin skim:
- Introduce only ~8–12 NEW words per unit (a controlled vocabulary load) so there is room to drill each one hard.
- Every new word must appear in ~6–8 exercises across its unit, CLIMBING a difficulty ladder rather than repeating one type: teach (meet it) → match (recognize) → choice (recognize among distractors) → blank (cued recall) → build (produce) → listen (hear + produce) → read (see it in real context).
- SPACE the exposures: 2–3 touches in the lesson that introduces the word, the rest in LATER lessons of the same unit — do not cram them all into one lesson.
- INTERLEAVE: every lesson mixes new words with words taught earlier in the unit, so earlier words keep getting recycled while new ones are introduced.
- Expect ~5–8 lessons and ~60–90 exercises per unit — that volume is intended; err toward MORE practice.
${
  opts.hasKnownWords
    ? '\nRECYCLE: also lean on the learner\'s KNOWN WORDS listed below — reuse them freely in sentences and distractors, and count only genuinely NEW words toward the 8–12 per-unit budget. List every new word in the unit "glossary" so it enters the learner\'s word bank.\n'
    : ''
}
Requirements: use stable unique ids and correct indices; include a unit "glossary" listing every new word with its gloss; add "teach" screens before drilling new concepts; make wrong choices plausible near-misses; keep sentences short and level-appropriate; include natural base-language translations.`
}

/** A human summary of every course/unit/lesson in a language, for the prompt. */
export function languageContextSummary(
  courses: Array<{ id: string; title: string }>,
  unitsOf: (courseId: string) => Array<{ id: string; index: number; title: string }>,
  lessonCount: (unitId: string) => number,
): string {
  if (courses.length === 0) return 'nothing yet — this is the first course in this language.'
  return courses
    .map((c) => {
      const us = [...unitsOf(c.id)].sort((a, b) => a.index - b.index)
      const body =
        us.length === 0
          ? 'no units yet'
          : us.map((u) => `unit ${u.index} "${u.title}" (${lessonCount(u.id)} lessons)`).join('; ')
      return `course.id "${c.id}" — "${c.title}": ${body}`
    })
    .join(' | ')
}

/** The separate, copyable "known words" block the user pastes alongside the
 *  prompt so authored content recycles vocabulary the learner already knows. */
export function buildKnownWordsBlock(words: Array<{ surface: string; gloss: string }>): string {
  if (words.length === 0) return ''
  const list = words.map((w) => `${w.surface} — ${w.gloss}`).join('\n')
  return `KNOWN WORDS — the learner already knows these ${words.length} words. Reuse them freely; introduce only a controlled number of NEW words and put every new word in a unit "glossary".

${list}`
}
