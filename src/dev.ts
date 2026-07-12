// Dev-only hooks (excluded from production by the dynamic import guard in main.tsx).
import { importBook } from './parsing/importBook'

export function installDevHooks(): void {
  ;(window as unknown as Record<string, unknown>).__breader = {
    /** Seed a book from a string without the file picker (console smoke tests). */
    importText: (text: string, lang = 'de', title = 'Sample') =>
      importBook(new File([text], `${title}.txt`, { type: 'text/plain' }), lang),
  }
}
