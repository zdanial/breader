import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from './schema'

export const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  model: 'gpt-4o-mini',
  theme: 'system',
  fontScale: 1,
  fontFamily: 'serif',
}

export function useSettings(): Settings {
  const stored = useLiveQuery(() => db.settings.get('singleton'), [])
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await db.settings.get('singleton')
  await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...patch })
}
