import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from './schema'

export const DEFAULT_ACCENT = '#2e63e8'

export const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  model: 'gpt-4o-mini',
  theme: 'system',
  fontScale: 1,
  fontFamily: 'serif',
  readAlign: 'center',
  accentColor: DEFAULT_ACCENT,
}

// Reading font: the design-system serif (DM Serif Display) for the brand
// reading experience, or Inter for a plainer sans read. Keyed so a
// script-specific stack (Hebrew/Arabic fast-follow) can slot in per language.
export const FONT_STACKS: Record<string, string> = {
  serif: "'DM Serif Display', Georgia, 'Times New Roman', serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

// Signal-family accent choices offered in Settings.
export const ACCENT_CHOICES: Array<[string, string]> = [
  ['#2e63e8', 'Blue'],
  ['#e5392c', 'Red'],
  ['#1f9d55', 'Green'],
  ['#e89a1f', 'Amber'],
  ['#8789f5', 'Indigo'],
]

export function useSettings(): Settings {
  const stored = useLiveQuery(() => db.settings.get('singleton'), [])
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await db.settings.get('singleton')
  await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...patch })
}
