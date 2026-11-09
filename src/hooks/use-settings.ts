import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import type { AppSettings } from '@/types/db'
import { DEFAULT_SETTINGS } from '@/services/settings-service'

/** Live settings row (re-renders when settings change). Falls back to defaults while loading. */
export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get('app'), [])
  return { ...DEFAULT_SETTINGS, updatedAt: 0, ...s }
}
