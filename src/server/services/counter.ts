import { sql } from 'drizzle-orm'
import type { Db } from '../db'
import { counters } from '../db/schema'

export type CounterId = 'sale' | 'purchase' | 'saleReturn' | 'purchaseReturn' | 'expense' | 'payment' | 'product' | 'barcode' | 'batch'

/**
 * Next value of a monotonic counter, atomically (safe with concurrent requests).
 * Call it with the transaction that saves the document, so a rolled-back save releases nothing twice.
 */
export async function nextCounter(db: Db, id: CounterId): Promise<number> {
  const [row] = await db
    .insert(counters)
    .values({ id, value: 1 })
    .onConflictDoUpdate({ target: counters.id, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value })
  return row.value
}

/** "INV-000123" */
export function formatDocNo(prefix: string, value: number, width = 6): string {
  return `${prefix}${String(value).padStart(width, '0')}`
}
