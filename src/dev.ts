// Dev-only hooks (excluded from production by the dynamic import guard in main.tsx).
import { commitImport, prepareImport } from './parsing/importBook'

async function importFile(file: File, lang?: string) {
  const preview = await prepareImport(file)
  return commitImport(preview, {
    title: preview.parsed.title,
    targetLang: lang ?? preview.suggestedLang ?? 'de',
  })
}

export function installDevHooks(): void {
  ;(window as unknown as Record<string, unknown>).__breader = {
    /** Seed a book from a string without the file picker (console smoke tests). */
    importText: (text: string, lang = 'de', title = 'Sample') =>
      importFile(new File([text], `${title}.txt`, { type: 'text/plain' }), lang),
    /** Import a book fetched from a URL (dev server /@fs/ paths work). */
    importUrl: async (url: string, lang?: string) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const name = url.split('/').pop() || 'book.epub'
      return importFile(new File([await res.blob()], name), lang)
    },
  }
}
