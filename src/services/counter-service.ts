import { db } from '@/db/database'
import type { Counter } from '@/types/db'

/**
 * Returns the next value of a monotonic counter. MUST be called inside a read-write
 * transaction that includes `counters` so the number is consumed only if the
 * surrounding document is actually saved.
 */
export async function nextCounter(id: Counter['id']): Promise<number> {
  const current = await db.counters.get(id)
  const value = (current?.value ?? 0) + 1
  await db.counters.put({ id, value })
  return value
}

/** "INV-000123" */
export function formatDocNo(prefix: string, value: number, width = 6): string {
  return `${prefix}${String(value).padStart(width, '0')}`
}
