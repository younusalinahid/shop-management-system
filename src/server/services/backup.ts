import { sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { BusinessError } from '@/lib/errors'
import journal from '../../../drizzle/meta/_journal.json'
import type { Db } from '../db'
import * as schema from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'

/**
 * Backup and restore of the whole shop as one JSON file.
 *
 * - The file carries the schema version (the last applied migration), so a backup can only be restored
 *   into the same version of the app.
 * - Restore replaces everything in one transaction: if any row fails, nothing changes. Login sessions are
 *   not part of a backup, so everyone signs in again afterwards.
 */

export const BACKUP_APP = 'shop-management-system'
export const SCHEMA_VERSION = journal.entries.at(-1)!.tag

/** Tables in insert order (parents before children). Sessions are deliberately left out. */
const TABLES: Array<[string, PgTable]> = [
  ['settings', schema.settings],
  ['counters', schema.counters],
  ['users', schema.users],
  ['auditLogs', schema.auditLogs],
  ['categories', schema.categories],
  ['brands', schema.brands],
  ['products', schema.products],
  ['productUnits', schema.productUnits],
  ['productBarcodes', schema.productBarcodes],
  ['productBatches', schema.productBatches],
  ['stockMovements', schema.stockMovements],
  ['suppliers', schema.suppliers],
  ['customers', schema.customers],
  ['purchases', schema.purchases],
  ['purchaseItems', schema.purchaseItems],
  ['sales', schema.sales],
  ['saleItems', schema.saleItems],
  ['salePayments', schema.salePayments],
  ['heldSales', schema.heldSales],
  ['payments', schema.payments],
  ['saleReturns', schema.saleReturns],
  ['saleReturnItems', schema.saleReturnItems],
  ['purchaseReturns', schema.purchaseReturns],
  ['purchaseReturnItems', schema.purchaseReturnItems],
  ['expenses', schema.expenses],
  ['cashMovements', schema.cashMovements],
  ['shifts', schema.shifts],
]

export interface BackupFile {
  app: typeof BACKUP_APP
  schemaVersion: string
  exportedAt: number
  exportedBy: string
  counts: Record<string, number>
  tables: Record<string, Array<Record<string, unknown>>>
}

export async function exportBackup(db: Db, actor: Actor): Promise<BackupFile> {
  assertCan(actor, 'backup.manage')
  const tables: BackupFile['tables'] = {}
  for (const [name, table] of TABLES) tables[name] = (await db.select().from(table)) as Array<Record<string, unknown>>
  const exportedAt = Date.now()
  // Remember when the last backup was taken (shown as a reminder in settings and on the dashboard).
  await db.transaction(async (tx) => {
    await tx.execute(sql`update ${schema.settings} set data = data || ${JSON.stringify({ lastBackupAt: exportedAt })}::jsonb where id = 'app'`)
    await writeAudit(tx, actor, { action: 'backup.export', module: 'backup', after: { counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) } })
  })
  return {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    exportedBy: actor.name,
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    tables,
  }
}

const fileSchema = z.object({
  app: z.literal(BACKUP_APP, { errorMap: () => ({ message: 'v.notBackup' }) }),
  schemaVersion: z.string(),
  exportedAt: z.number(),
  tables: z.record(z.array(z.record(z.unknown()))),
})

/** Check a backup file without changing anything. Returns what it contains. */
export function inspectBackup(input: unknown): { exportedAt: number; counts: Record<string, number> } {
  const file = fileSchema.parse(input)
  if (file.schemaVersion !== SCHEMA_VERSION) {
    throw new BusinessError('backup_version', `This backup is from another app version (${file.schemaVersion}); this app is ${SCHEMA_VERSION}.`, {
      values: { found: file.schemaVersion, expected: SCHEMA_VERSION },
    })
  }
  const names = new Set(TABLES.map(([n]) => n))
  const unknown = Object.keys(file.tables).filter((k) => !names.has(k))
  if (unknown.length) throw new BusinessError('invalid', `Unknown tables in the backup: ${unknown.join(', ')}.`, { key: 'backupUnknownTables', values: { tables: unknown.join(', ') } })
  const users = file.tables.users ?? []
  if (!users.some((u) => u.role === 'owner' && u.status === 'active')) throw new BusinessError('invalid', 'The backup has no active owner, so nobody could sign in.', { key: 'backupNoOwner' })
  return { exportedAt: file.exportedAt, counts: Object.fromEntries(TABLES.map(([n]) => [n, file.tables[n]?.length ?? 0])) }
}

/** Replace all data with the backup, atomically. Everyone is signed out. */
export async function restoreBackup(db: Db, actor: Actor, input: unknown): Promise<{ counts: Record<string, number> }> {
  assertCan(actor, 'backup.manage')
  const info = inspectBackup(input)
  const file = input as BackupFile
  await db.transaction(async (tx) => {
    const names = [...TABLES.map(([, t]) => t), schema.sessions].map((t) => `"${(t as unknown as Record<symbol, string>)[Symbol.for('drizzle:Name')]}"`)
    await tx.execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`))
    for (const [name, table] of TABLES) {
      let rows = file.tables[name] ?? []
      // Parent categories before their children (a category can sit inside another).
      if (name === 'categories') rows = sortParentsFirst(rows)
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(table).values(rows.slice(i, i + 500) as never)
      }
    }
    await writeAudit(tx, actor, { action: 'backup.restore', module: 'backup', after: { exportedAt: info.exportedAt, counts: info.counts } })
  })
  return { counts: info.counts }
}

function sortParentsFirst(rows: Array<Record<string, unknown>>) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depth = (r: Record<string, unknown>, seen = 0): number => (r.parentId && byId.has(r.parentId) && seen < 50 ? 1 + depth(byId.get(r.parentId)!, seen + 1) : 0)
  return [...rows].sort((a, b) => depth(a) - depth(b))
}

