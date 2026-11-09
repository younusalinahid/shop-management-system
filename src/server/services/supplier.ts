import { asc, eq, sql } from 'drizzle-orm'
import type { ID, RecordStatus } from '@/types/db'
import { BusinessError } from '@/lib/errors'
import { type Supplier, supplierSchema, type SupplierInput } from '@/lib/inventory'
import type { Db } from '../db'
import { suppliers } from '../db/schema'
import { type Actor, assertCan, diffFields, writeAudit } from './audit'

/**
 * Suppliers, as far as purchases need them: name, contact and the payable balance that purchases
 * on credit create. Supplier payments and the full ledger arrive in Phase 5.
 */

type Row = typeof suppliers.$inferSelect
export const toSupplier = (r: Row): Supplier => ({
  ...r,
  companyName: r.companyName ?? undefined,
  phone: r.phone ?? undefined,
  address: r.address ?? undefined,
})

export async function listSuppliers(db: Db): Promise<Supplier[]> {
  return (await db.select().from(suppliers).orderBy(asc(suppliers.name))).map(toSupplier)
}

async function assertNameFree(db: Db, name: string, exceptId?: ID) {
  const [clash] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(sql`lower(${suppliers.name}) = lower(${name})`)
  if (clash && clash.id !== exceptId) throw new BusinessError('duplicate_supplier', `Supplier “${name}” already exists.`, { values: { name } })
}

export async function createSupplier(db: Db, actor: Actor, input: SupplierInput): Promise<Supplier> {
  assertCan(actor, 'purchases.manage')
  const data = supplierSchema.parse(input)
  return db.transaction(async (tx) => {
    await assertNameFree(tx, data.name)
    const now = Date.now()
    const [row] = await tx
      .insert(suppliers)
      .values({
        name: data.name,
        companyName: data.companyName || null,
        phone: data.phone || null,
        address: data.address || null,
        openingBalance: data.openingBalance,
        balance: data.openingBalance,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const s = toSupplier(row)
    await writeAudit(tx, actor, { action: 'supplier.create', module: 'suppliers', entityId: s.id, after: data })
    return s
  })
}

/** Contact details only; the opening balance is fixed once purchases may depend on it. */
export async function updateSupplier(db: Db, actor: Actor, id: ID, input: SupplierInput): Promise<Supplier> {
  assertCan(actor, 'purchases.manage')
  const data = supplierSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).for('update')
    if (!row) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
    await assertNameFree(tx, data.name, id)
    const patch = { name: data.name, companyName: data.companyName || null, phone: data.phone || null, address: data.address || null }
    const diff = diffFields(row, patch)
    if (!diff.changed) return toSupplier(row)
    const now = Date.now()
    await tx.update(suppliers).set({ ...patch, updatedAt: now }).where(eq(suppliers.id, id))
    await writeAudit(tx, actor, { action: 'supplier.update', module: 'suppliers', entityId: id, before: diff.before, after: diff.after })
    return toSupplier({ ...row, ...patch, updatedAt: now })
  })
}

export async function setSupplierStatus(db: Db, actor: Actor, id: ID, status: RecordStatus): Promise<void> {
  assertCan(actor, 'purchases.manage')
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: suppliers.status }).from(suppliers).where(eq(suppliers.id, id))
    if (!row) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
    if (row.status === status) return
    await tx.update(suppliers).set({ status, updatedAt: Date.now() }).where(eq(suppliers.id, id))
    await writeAudit(tx, actor, { action: `supplier.${status === 'archived' ? 'archive' : 'restore'}`, module: 'suppliers', entityId: id })
  })
}
