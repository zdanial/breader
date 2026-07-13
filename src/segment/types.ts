// Pluggable sentence segmentation, keyed by language — mirrors the file-type
// parser registry. A default segmenter handles any language; language-specific
// segmenters override it where a script or convention needs special handling.

export interface LanguageSegmenter {
  /** BCP-47 primary subtags this segmenter claims (e.g. ['de'], ['ar']). */
  langs: string[]
  /** Split one paragraph of `lang` into sentences. */
  segment(paragraph: string, lang: string): string[]
}
