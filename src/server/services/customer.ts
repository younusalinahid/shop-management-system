import { asc, eq } from 'drizzle-orm'
import { BusinessError } from '@/lib/errors'
import { type Customer, customerSchema, type CustomerInput } from '@/lib/sales'
import type { Db } from '../db'
import { customers } from '../db/schema'
import { type Actor, assertCan, diffFields, writeAudit } from './audit'

/**
 * Customers, as far as the POS needs them: name, phone, price mode and the receivable that sales on
 * credit create. Due collection and the full ledger arrive in Phase 5.
 */

type Row = typeof customers.$inferSelect
export const toCustomer = (r: Row): Customer => ({
  ...r,
  phone: r.phone ?? undefined,
  address: r.address ?? undefined,
  priceMode: r.priceMode ?? undefined,
  notes: r.notes ?? undefined,
})

export async function listCustomers(db: Db): Promise<Customer[]> {
  return (await db.select().from(customers).orderBy(asc(customers.name))).map(toCustomer)
}

/** Cashiers add customers from the POS, so selling is enough. */
export async function createCustomer(db: Db, actor: Actor, input: CustomerInput): Promise<Customer> {
  assertCan(actor, 'pos.sell')
  const data = customerSchema.parse(input)
  return db.transaction(async (tx) => {
    if (data.phone) {
      const [clash] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.phone, data.phone))
      if (clash) throw new BusinessError('duplicate_customer', `Phone ${data.phone} already belongs to “${clash.name}”.`, { values: { phone: data.phone, name: clash.name } })
    }
    const now = Date.now()
    const [row] = await tx
      .insert(customers)
      .values({
        name: data.name,
        phone: data.phone || null,
        address: data.address || null,
        openingBalance: data.openingBalance,
        balance: data.openingBalance,
        priceMode: data.priceMode ?? null,
        notes: data.notes || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const c = toCustomer(row)
    await writeAudit(tx, actor, { action: 'customer.create', module: 'customers', entityId: c.id, after: data })
    return c
  })
}

/** Contact details and price mode. The opening balance is fixed once sales may depend on it. */
export async function updateCustomer(db: Db, actor: Actor, id: string, input: CustomerInput): Promise<Customer> {
  assertCan(actor, 'parties.edit')
  const data = customerSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(customers).where(eq(customers.id, id)).for('update')
    if (!row) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
    if (data.phone) {
      const [clash] = await tx.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.phone, data.phone))
      if (clash && clash.id !== id) throw new BusinessError('duplicate_customer', `Phone ${data.phone} already belongs to “${clash.name}”.`, { values: { phone: data.phone, name: clash.name } })
    }
    const patch = { name: data.name, phone: data.phone || null, address: data.address || null, priceMode: data.priceMode ?? null, notes: data.notes || null }
    const diff = diffFields(row, patch)
    if (!diff.changed) return toCustomer(row)
    const now = Date.now()
    await tx.update(customers).set({ ...patch, updatedAt: now }).where(eq(customers.id, id))
    await writeAudit(tx, actor, { action: 'customer.update', module: 'customers', entityId: id, before: diff.before, after: diff.after })
    return toCustomer({ ...row, ...patch, updatedAt: now })
  })
}

export async function setCustomerStatus(db: Db, actor: Actor, id: string, status: 'active' | 'archived'): Promise<void> {
  assertCan(actor, 'parties.edit')
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: customers.status }).from(customers).where(eq(customers.id, id))
    if (!row) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
    if (row.status === status) return
    await tx.update(customers).set({ status, updatedAt: Date.now() }).where(eq(customers.id, id))
    await writeAudit(tx, actor, { action: `customer.${status === 'archived' ? 'archive' : 'restore'}`, module: 'customers', entityId: id })
  })
}
