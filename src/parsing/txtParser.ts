import type { BookParser } from './types'
import { splitParagraphs } from './segmenter'

/** Best-effort author from common .txt conventions (e.g. Project Gutenberg headers). */
function inferAuthor(text: string): string | undefined {
  const head = text.slice(0, 3000)
  const labeled = head.match(/^Author:\s*(.+)$/m)?.[1]?.trim()
  if (labeled) return labeled
  // "Title\nby Firstname Lastname" — capitalized words following a standalone "by"
  return head.match(
    /\bby\s+([A-ZÀ-Þ][\p{L}.'’-]+(?:\s+[A-ZÀ-Þ][\p{L}.'’-]+){0,3})\s*$/mu,
  )?.[1]
}

export const txtParser: BookParser = {
  format: 'txt',
  extensions: ['txt'],
  async parse(file) {
    const text = await file.text()
    const title = file.name.replace(/\.[^.]+$/, '')
    return {
      title,
      author: inferAuthor(text),
      chapters: [{ title, paragraphs: splitParagraphs(text) }],
    }
  },
}
