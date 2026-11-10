import { and, asc, count, desc, eq, gte, ilike, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { DateOnly, ID } from '@/types/db'
import { addDays, startOfDateOnly } from '@/lib/datetime'
import { BusinessError } from '@/lib/errors'
import type { Page } from '@/lib/inventory'
import { type LedgerEntry, partyPaymentSchema, type PartyPaymentInput, type PaymentKind, type PaymentRecord, voidSchema } from '@/lib/parties'
import type { Db } from '../db'
import { customers, payments, purchaseReturns, purchases, saleReturns, sales, suppliers } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'

/**
 * PaymentService: due collections from customers, payments to suppliers, and the refund rows that
 * returns create. Each one moves the party's cached balance in the same transaction. Payments are never
 * deleted; voiding restores the balance and keeps the record.
 */

type Row = typeof payments.$inferSelect
const toRecord = (r: Row): PaymentRecord => ({
  ...r,
  reference: r.reference ?? undefined,
  note: r.note ?? undefined,
  refType: r.refType ?? undefined,
  refId: r.refId ?? undefined,
  voidedAt: r.voidedAt ?? undefined,
  voidReason: r.voidReason ?? undefined,
})

export interface NewPaymentRow {
  partyType: 'customer' | 'supplier'
  partyId: ID
  partyName: string
  kind: PaymentKind
  method: Row['method']
  amount: number
  reference?: string
  note?: string
  refType?: string
  refId?: ID
  idempotencyKey?: string
}

/** Insert a payment row (inside the caller's transaction). The caller moves the party balance. */
export async function insertPayment(tx: Db, actor: Actor, p: NewPaymentRow): Promise<PaymentRecord> {
  const paymentNo = formatDocNo('PAY-', await nextCounter(tx, 'payment'))
  const [row] = await tx
    .insert(payments)
    .values({
      paymentNo,
      idempotencyKey: p.idempotencyKey ?? crypto.randomUUID(),
      partyType: p.partyType,
      partyId: p.partyId,
      partyName: p.partyName,
      kind: p.kind,
      direction: p.kind === 'due_collection' || p.kind === 'supplier_refund' ? 'in' : 'out',
      method: p.method,
      amount: p.amount,
      reference: p.reference || null,
      note: p.note || null,
      refType: p.refType ?? null,
      refId: p.refId ?? null,
      userId: actor.id,
      userName: actor.name,
      createdAt: Date.now(),
    })
    .returning()
  return toRecord(row)
}

async function byKey(db: Db, key: string) {
  const [r] = await db.select().from(payments).where(eq(payments.idempotencyKey, key))
  return r ? toRecord(r) : null
}

/** Collect money a customer owes. Cannot be more than the current due. */
export async function collectDue(db: Db, actor: Actor, input: PartyPaymentInput): Promise<PaymentRecord> {
  assertCan(actor, 'payments.manage')
  const data = partyPaymentSchema.parse(input)
  const existing = await byKey(db, data.idempotencyKey)
  if (existing) return existing
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, data.partyId)).for('update')
    if (!c) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
    if (data.amount > c.balance) throw new BusinessError('overpaid', `${c.name} owes only ${c.balance} poisha.`, { key: 'moreThanDue', values: { name: c.name } })
    await tx.update(customers).set({ balance: sql`${customers.balance} - ${data.amount}`, updatedAt: Date.now() }).where(eq(customers.id, c.id))
    const p = await insertPayment(tx, actor, { ...data, partyType: 'customer', partyName: c.name, kind: 'due_collection' })
    await writeAudit(tx, actor, { action: 'payment.due_collection', module: 'payments', entityId: p.id, after: { paymentNo: p.paymentNo, customer: c.name, amount: data.amount, method: data.method } })
    return p
  })
}

/** Pay money the shop owes a supplier. Cannot be more than the current payable. */
export async function paySupplier(db: Db, actor: Actor, input: PartyPaymentInput): Promise<PaymentRecord> {
  assertCan(actor, 'purchases.manage')
  const data = partyPaymentSchema.parse(input)
  const existing = await byKey(db, data.idempotencyKey)
  if (existing) return existing
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, data.partyId)).for('update')
    if (!s) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
    if (data.amount > s.balance) throw new BusinessError('overpaid', `You owe ${s.name} less than that.`, { key: 'moreThanPayable', values: { name: s.name } })
    await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${data.amount}`, updatedAt: Date.now() }).where(eq(suppliers.id, s.id))
    const p = await insertPayment(tx, actor, { ...data, partyType: 'supplier', partyName: s.name, kind: 'supplier_payment' })
    await writeAudit(tx, actor, { action: 'payment.supplier_payment', module: 'payments', entityId: p.id, after: { paymentNo: p.paymentNo, supplier: s.name, amount: data.amount, method: data.method } })
    return p
  })
}

/** Void a due collection or supplier payment entered by mistake: the balance goes back up. */
export async function voidPayment(db: Db, actor: Actor, id: ID, input: { reason: string }): Promise<PaymentRecord> {
  const { reason } = voidSchema.parse(input)
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for('update')
    if (!p) throw new BusinessError('not_found', 'Payment not found.', { key: 'paymentNotFound' })
    assertCan(actor, p.partyType === 'customer' ? 'payments.manage' : 'purchases.manage')
    // Only managers and owners may undo money records.
    assertCan(actor, 'cash.manage')
    if (p.voidedAt) throw new BusinessError('conflict', 'This payment is already void.', { key: 'alreadyVoid' })
    if (p.kind !== 'due_collection' && p.kind !== 'supplier_payment') throw new BusinessError('conflict', 'Refunds are part of a return and cannot be voided on their own.', { key: 'refundNotVoidable' })
    const now = Date.now()
    if (p.partyType === 'customer') {
      await tx.update(customers).set({ balance: sql`${customers.balance} + ${p.amount}`, updatedAt: now }).where(eq(customers.id, p.partyId))
    } else {
      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${p.amount}`, updatedAt: now }).where(eq(suppliers.id, p.partyId))
    }
    const [row] = await tx.update(payments).set({ voidedAt: now, voidReason: reason }).where(eq(payments.id, id)).returning()
    await writeAudit(tx, actor, { action: 'payment.void', module: 'payments', entityId: id, before: { amount: p.amount }, reason })
    return toRecord(row)
  })
}

export interface PaymentFilter {
  partyType?: 'customer' | 'supplier'
  partyId?: ID
  kind?: PaymentKind
  q?: string
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listPayments(db: Db, f: PaymentFilter): Promise<Page<PaymentRecord> & { totals: { in: number; out: number } }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const q = f.q?.trim()
  const where = and(
    f.partyType ? eq(payments.partyType, f.partyType) : undefined,
    f.partyId ? eq(payments.partyId, f.partyId) : undefined,
    f.kind ? eq(payments.kind, f.kind) : undefined,
    q ? or(ilike(payments.partyName, `%${q}%`), ilike(payments.paymentNo, `%${q}%`), ilike(payments.reference, `%${q}%`)) : undefined,
    f.from ? gte(payments.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(payments.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
  )
  const live = isNull(payments.voidedAt)
  const [rows, [agg]] = await Promise.all([
    db.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({
        n: count(),
        in: sql<string>`coalesce(sum(${payments.amount}) filter (where ${live} and ${payments.direction} = 'in'), 0)`,
        out: sql<string>`coalesce(sum(${payments.amount}) filter (where ${live} and ${payments.direction} = 'out'), 0)`,
      })
      .from(payments)
      .where(where),
  ])
  return { page, pageSize, total: agg.n, totals: { in: Number(agg.in), out: Number(agg.out) }, items: rows.map(toRecord) }
}

// ---------------------------------------------------------------- ledgers

function running(entries: Omit<LedgerEntry, 'balance'>[]): LedgerEntry[] {
  let balance = 0
  return entries
    .sort((a, b) => a.date - b.date || (a.kind === 'opening' ? -1 : 0))
    .map((e) => {
      balance += e.change
      return { ...e, balance }
    })
}

/**
 * A customer's account from the source documents: opening balance, + due left on each sale, − due
 * settled by returns, − collections. The final balance equals the cached `customers.balance`.
 */
export async function customerLedger(db: Db, id: ID): Promise<LedgerEntry[]> {
  const [c] = await db.select().from(customers).where(eq(customers.id, id))
  if (!c) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
  const [saleRows, returnRows, payRows] = await Promise.all([
    db.select().from(sales).where(and(eq(sales.customerId, id), ne(sales.status, 'cancelled'))).orderBy(asc(sales.createdAt)),
    db.select().from(saleReturns).where(eq(saleReturns.customerId, id)),
    db.select().from(payments).where(and(eq(payments.partyType, 'customer'), eq(payments.partyId, id), eq(payments.kind, 'due_collection'), isNull(payments.voidedAt))),
  ])
  return running([
    ...(c.openingBalance ? [{ kind: 'opening' as const, date: c.createdAt, change: c.openingBalance }] : []),
    ...saleRows.map((s) => ({ kind: 'sale' as const, date: s.createdAt, ref: s.invoiceNo, refId: s.id, amount: s.total, change: s.due })),
    ...returnRows.filter((r) => r.dueAdjusted > 0).map((r) => ({ kind: 'sale_return' as const, date: r.createdAt, ref: r.returnNo, refId: r.id, amount: r.total, change: -r.dueAdjusted })),
    ...payRows.map((p) => ({ kind: 'payment' as const, date: p.createdAt, ref: p.paymentNo, refId: p.id, description: p.method, amount: p.amount, change: -p.amount })),
  ])
}

/** A supplier's account: opening balance, + due left on each purchase, − returns settled against it, − payments. */
export async function supplierLedger(db: Db, id: ID): Promise<LedgerEntry[]> {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!s) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
  const [purchaseRows, returnRows, payRows] = await Promise.all([
    db.select().from(purchases).where(and(eq(purchases.supplierId, id), ne(purchases.status, 'cancelled'))),
    db.select().from(purchaseReturns).where(eq(purchaseReturns.supplierId, id)),
    db.select().from(payments).where(and(eq(payments.partyType, 'supplier'), eq(payments.partyId, id), eq(payments.kind, 'supplier_payment'), isNull(payments.voidedAt))),
  ])
  return running([
    ...(s.openingBalance ? [{ kind: 'opening' as const, date: s.createdAt, change: s.openingBalance }] : []),
    ...purchaseRows.map((p) => ({ kind: 'purchase' as const, date: p.createdAt, ref: p.purchaseNo, refId: p.id, amount: p.total, change: p.due })),
    ...returnRows.filter((r) => r.payableAdjusted > 0).map((r) => ({ kind: 'purchase_return' as const, date: r.createdAt, ref: r.returnNo, refId: r.id, amount: r.total, change: -r.payableAdjusted })),
    ...payRows.map((p) => ({ kind: 'payment' as const, date: p.createdAt, ref: p.paymentNo, refId: p.id, description: p.method, amount: p.amount, change: -p.amount })),
  ])
}

