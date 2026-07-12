// EPUB parsing: unzip → container.xml → OPF (metadata, manifest, spine) →
// spine XHTML documents → chapters with paragraph text. Chapter titles come
// from the EPUB3 nav doc or NCX when available, else the chapter's first
// heading, else "Chapter N".
import { unzipSync } from 'fflate'
import type { BookParser, ParsedChapter, ParsedDoc } from './types'

const decoder = new TextDecoder()

/** Resolve a (possibly relative) href against the directory of a base file path. */
function resolvePath(href: string, baseFile: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  const stack = baseFile.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function parseXml(text: string, type: DOMParserSupportedType): Document {
  return new DOMParser().parseFromString(text, type)
}

/** First matching element by local tag name, namespace-agnostic (dc:title etc.). */
function byLocalName(root: Document | Element, name: string): Element | undefined {
  return Array.from(root.getElementsByTagName('*')).find(
    (el) => el.localName.toLowerCase() === name,
  )
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, td, figcaption'

/** Extract paragraph-level text blocks from a chapter document, in order. */
function extractParagraphs(doc: Document): string[] {
  const blocks = Array.from(doc.body?.querySelectorAll(BLOCK_SELECTOR) ?? [])
  const out: string[] = []
  for (const el of blocks) {
    // skip containers whose text will be covered by a nested block element
    if (el.querySelector(BLOCK_SELECTOR)) continue
    const text = el.textContent?.replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
  }
  return out
}

/** Map spine file paths → titles using the EPUB3 nav document or the NCX. */
function tocTitles(
  files: Record<string, Uint8Array>,
  opfPath: string,
  opf: Document,
  manifest: Map<string, { href: string; mediaType: string; properties: string }>,
): Map<string, string> {
  const titles = new Map<string, string>()

  const record = (href: string, tocFile: string, label: string | null | undefined) => {
    const title = label?.replace(/\s+/g, ' ').trim()
    const path = resolvePath(href, tocFile)
    if (title && !titles.has(path)) titles.set(path, title)
  }

  // EPUB3 <nav epub:type="toc">
  const navItem = [...manifest.values()].find((m) => m.properties.includes('nav'))
  if (navItem) {
    const navPath = resolvePath(navItem.href, opfPath)
    const data = files[navPath]
    if (data) {
      const doc = parseXml(decoder.decode(data), 'text/html')
      for (const a of Array.from(doc.querySelectorAll('nav a[href]'))) {
        record(a.getAttribute('href')!, navPath, a.textContent)
      }
      if (titles.size > 0) return titles
    }
  }

  // EPUB2 NCX fallback
  const spineEl = byLocalName(opf, 'spine')
  const ncxId = spineEl?.getAttribute('toc')
  const ncxItem = ncxId ? manifest.get(ncxId) : undefined
  if (ncxItem) {
    const ncxPath = resolvePath(ncxItem.href, opfPath)
    const data = files[ncxPath]
    if (data) {
      const doc = parseXml(decoder.decode(data), 'application/xml')
      for (const point of Array.from(doc.getElementsByTagName('*'))) {
        if (point.localName !== 'navPoint') continue
        const label = byLocalName(point, 'text')?.textContent
        const src = byLocalName(point, 'content')?.getAttribute('src')
        if (src) record(src, ncxPath, label)
      }
    }
  }
  return titles
}

export const epubParser: BookParser = {
  format: 'epub',
  extensions: ['epub'],
  async parse(file) {
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(new Uint8Array(await file.arrayBuffer()))
    } catch {
      throw new Error('Not a valid EPUB (could not unzip)')
    }

    const container = files['META-INF/container.xml']
    if (!container) throw new Error('Not a valid EPUB (missing container.xml)')
    const containerDoc = parseXml(decoder.decode(container), 'application/xml')
    const opfPath = byLocalName(containerDoc, 'rootfile')?.getAttribute('full-path')
    if (!opfPath || !files[opfPath]) throw new Error('Not a valid EPUB (missing OPF)')

    const opf = parseXml(decoder.decode(files[opfPath]), 'application/xml')
    const title =
      byLocalName(opf, 'title')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '')
    const author = byLocalName(opf, 'creator')?.textContent?.trim() || undefined
    const language =
      byLocalName(opf, 'language')?.textContent?.trim().toLowerCase().split('-')[0] || undefined

    // manifest: id → item
    const manifest = new Map<string, { href: string; mediaType: string; properties: string }>()
    for (const el of Array.from(opf.getElementsByTagName('*'))) {
      if (el.localName !== 'item') continue
      const id = el.getAttribute('id')
      const href = el.getAttribute('href')
      if (id && href) {
        manifest.set(id, {
          href,
          mediaType: el.getAttribute('media-type') ?? '',
          properties: el.getAttribute('properties') ?? '',
        })
      }
    }

    const titles = tocTitles(files, opfPath, opf, manifest)

    // spine order → chapters
    const chapters: ParsedChapter[] = []
    for (const el of Array.from(opf.getElementsByTagName('*'))) {
      if (el.localName !== 'itemref') continue
      const item = manifest.get(el.getAttribute('idref') ?? '')
      if (!item || !/xhtml|html/.test(item.mediaType)) continue
      const path = resolvePath(item.href, opfPath)
      const data = files[path]
      if (!data) continue

      const doc = parseXml(decoder.decode(data), 'text/html')
      const paragraphs = extractParagraphs(doc)
      if (paragraphs.length === 0) continue // covers, image-only pages

      const heading = doc.body?.querySelector('h1, h2, h3')?.textContent
      const chapterTitle =
        titles.get(path) ||
        heading?.replace(/\s+/g, ' ').trim() ||
        `Chapter ${chapters.length + 1}`
      chapters.push({ title: chapterTitle, paragraphs })
    }

    if (chapters.length === 0) throw new Error('No readable chapters found in EPUB')
    return { title, author, language, chapters } satisfies ParsedDoc
  },
}
