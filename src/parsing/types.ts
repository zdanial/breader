// The pluggable import pipeline: SourceFile → parser → ParsedDoc → segmenter → Sentence[].
// PDF (and any future format) drops in behind BookParser without touching the reader.

export interface ParsedChapter {
  title: string
  paragraphs: string[]
}

export interface ParsedDoc {
  title: string
  author?: string
  chapters: ParsedChapter[]
}

export interface BookParser {
  format: 'txt' | 'epub'
  extensions: string[]
  parse(file: File): Promise<ParsedDoc>
}
