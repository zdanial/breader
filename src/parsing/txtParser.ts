import type { BookParser } from './types'
import { splitParagraphs } from './segmenter'

export const txtParser: BookParser = {
  format: 'txt',
  extensions: ['txt'],
  async parse(file) {
    const text = await file.text()
    const title = file.name.replace(/\.[^.]+$/, '')
    return {
      title,
      chapters: [{ title, paragraphs: splitParagraphs(text) }],
    }
  },
}
