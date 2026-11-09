import { useQuery } from '@tanstack/react-query'
import type { AppSettings } from '@/types/db'
import { api } from '@/lib/api-client'
import { DEFAULT_SETTINGS } from '@/lib/settings'

export const settingsQuery = { queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings') }

/** Shop settings from GET /api/settings. Defaults (with updatedAt 0) while loading. */
export function useSettings(): AppSettings {
  const { data } = useQuery(settingsQuery)
  return data ?? { ...DEFAULT_SETTINGS, updatedAt: 0 }
}
