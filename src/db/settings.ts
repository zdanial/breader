import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from './schema'

export const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  model: 'gpt-4o-mini',
  theme: 'system',
  fontScale: 1,
  fontFamily: 'serif',
}

// Reading font options. System stacks only (no webfont downloads); keyed so a
// script-specific stack (Hebrew/Arabic fast-follow) can slot in per language.
export const FONT_STACKS: Record<string, string> = {
  serif: "'Iowan Old Style', Palatino, Georgia, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

export function useSettings(): Settings {
  const stored = useLiveQuery(() => db.settings.get('singleton'), [])
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await db.settings.get('singleton')
  await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...patch })
}
