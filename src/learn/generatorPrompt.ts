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
            { "type": "listen", "text": "<target sentence to speak>", "tiles": ["...","..."], "answer": ["...","..."], "translation": "..." }
          ] } ] } ]
}`

const ITEM_UX = `How each item appears to the learner (write content that fits):
- "teach": a full-screen card (title + explanation + optional example pairs), no input — introduces a concept before drills.
- "choice": a question with tappable options; exactly one correct ("answer" = index). Distractors must be plausible.
- "build": the learner taps word tiles in order to build the target sentence; "tiles" = the correct words PLUS believable extra tiles; "answer" = the correct ordered words.
- "match": two columns the learner pairs (target ↔ base); 3–5 pairs.
- "blank": a sentence with a gap; the learner picks the word that fills it.
- "listen": the learner hears the target sentence "text" spoken aloud (text-to-speech) and rebuilds it from word tiles; "tiles" = the correct words PLUS distractor tiles, "answer" = the correct ordered words. Use short, clearly pronounceable target sentences.
Any target word is tappable for a gloss, so include a "glossary" for the vocabulary used.`

export function buildGeneratorPrompt(opts: {
  targetLang: string
  baseLang: string
  courseContext: string // "New course." or a summary of existing structure
}): string {
  return `You are authoring language-learning content for the "Learn" section of an app. When you are ready, output ONLY valid JSON matching this schema — but NOT yet:

${SCHEMA}

${ITEM_UX}

- Target language: ${langLabel(opts.targetLang)}. Base language: ${langLabel(opts.baseLang)}.
- Course context: ${opts.courseContext}
- Source material: <<< PASTE YOUR SOURCE CONTENT HERE >>>

FIRST, before generating anything, ask me clarifying questions to confirm how to structure this — how much of the material warrants a unit vs a lesson, the level, the scope, whether to extend existing units or add new ones, ordering, and anything ambiguous. DECIDE THE NUMBER OF UNITS AND LESSONS YOURSELF from the amount and nature of the content — do not use a fixed count. Only after I confirm, output the JSON (course meta + the new/updated units).

Requirements: keep the exact "course.id" I give you so it merges correctly; use stable unique ids and correct indices; include a unit "glossary" of the vocabulary used; add "teach" screens before drilling new concepts; make wrong choices plausible near-misses; keep sentences short and level-appropriate; include natural base-language translations.`
}

/** A human summary of a course's current structure for the prompt context. */
export function courseContextSummary(
  courseId: string,
  units: Array<{ id: string; index: number; title: string }>,
  lessonCount: (unitId: string) => number,
): string {
  if (units.length === 0) return `New course. Use course.id "${courseId}".`
  const sorted = [...units].sort((a, b) => a.index - b.index)
  const list = sorted
    .map((u) => `Unit ${u.index} "${u.title}" (${lessonCount(u.id)} lessons)`)
    .join('; ')
  const nextIndex = Math.max(...sorted.map((u) => u.index)) + 1
  return `This course (course.id "${courseId}") already contains: ${list}. Next unit index is ${nextIndex}. You may add new units and/or add lessons to existing units (reuse their ids).`
}
