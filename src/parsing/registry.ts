import type { BookParser } from './types'
import { txtParser } from './txtParser'

const parsers: BookParser[] = [txtParser] // epubParser lands in Slice 4, pdf post-MVP

export const acceptedExtensions = (): string =>
  parsers.flatMap((p) => p.extensions).map((e) => `.${e}`).join(',')

export function pickParser(file: File): BookParser {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const parser = parsers.find((p) => p.extensions.includes(ext))
  if (!parser) throw new Error(`Unsupported file type ".${ext}" — supported: ${acceptedExtensions()}`)
  return parser
}
