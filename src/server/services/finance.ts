import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import type { DateOnly, ID, PaymentMethod } from '@/types/db'
import { addDays, startOfDateOnly } from '@/lib/datetime'
import { BusinessError } from '@/lib/errors'
import {
  type CashBook,
  type CashEvent,
  cashMovementSchema,
  type CashMovementInput,
  closeShiftSchema,
  expenseSchema,
  type ExpenseInput,
  type ExpenseRecord,
  openShiftSchema,
  type ProfitAndLoss,
  type ShiftRecord,
} from '@/lib/finance'
import type { Page } from '@/lib/inventory'
import { PAYMENT_METHODS } from '@/lib/sales'
import type { Db } from '../db'
import { cashMovements, expenses, payments, purchaseReturns, purchases, salePayments, saleReturns, sales, shifts, stockMovements } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'
import { getSettings } from './settings'

/**
 * Cash and financial management. Money is never stored twice: the cash book is built from the
 * documents that moved the money (sale payments, collections, purchases, refunds, expenses, cash in/out),
 * so it always agrees with them. Shifts compare a cashier's counted drawer with that book.
 */

// ---------------------------------------------------------------- expenses

type ExpenseRow = typeof expenses.$inferSelect
const toExpense = (r: ExpenseRow): ExpenseRecord => ({ ...r, description: r.description ?? undefined, voidReason: r.voidReason ?? undefined })

export async function createExpense(db: Db, actor: Actor, input: ExpenseInput): Promise<ExpenseRecord> {
  assertCan(actor, 'expenses.manage')
  const data = expenseSchema.parse(input)
  const [dup] = await db.select().from(expenses).where(eq(expenses.idempotencyKey, data.idempotencyKey))
  if (dup) return toExpense(dup)
  return db.transaction(async (tx) => {
    const expenseNo = formatDocNo('EXP-', await nextCounter(tx, 'expense'))
    const [row] = await tx
      .insert(expenses)
      .values({ ...data, expenseNo, description: data.description || null, status: 'active', userId: actor.id, userName: actor.name, createdAt: Date.now() })
      .returning()
    await writeAudit(tx, actor, { action: 'expense.create', module: 'expenses', entityId: row.id, after: { expenseNo, category: data.category, amount: data.amount, method: data.method } })
    return toExpense(row)
  })
}

/** Expenses are never deleted; a wrong one is voided with a reason. */
export async function voidExpense(db: Db, actor: Actor, id: ID, reason: string): Promise<ExpenseRecord> {
  assertCan(actor, 'expenses.manage')
  if (!reason.trim()) throw new BusinessError('invalid', 'Write the reason.', { key: 'reasonMissing' })
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
    if (!row) throw new BusinessError('not_found', 'Expense not found.', { key: 'expenseNotFound' })
    if (row.status === 'void') throw new BusinessError('conflict', 'This expense is already void.', { key: 'alreadyVoid' })
    const [next] = await tx.update(expenses).set({ status: 'void', voidReason: reason.trim() }).where(eq(expenses.id, id)).returning()
    await writeAudit(tx, actor, { action: 'expense.void', module: 'expenses', entityId: id, before: { amount: row.amount }, reason })
    return toExpense(next)
  })
}

export async function listExpenses(
  db: Db,
  f: { from?: DateOnly; to?: DateOnly; category?: string; page?: number; pageSize?: number },
): Promise<Page<ExpenseRecord> & { totals: { total: number; byCategory: Array<{ category: string; amount: number }> }; categories: string[] }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const where = and(
    f.from ? gte(expenses.expenseDate, f.from) : undefined,
    f.to ? sql`${expenses.expenseDate} <= ${f.to}` : undefined,
    f.category ? eq(expenses.category, f.category) : undefined,
  )
  const [rows, [n], byCat, cats] = await Promise.all([
    db.select().from(expenses).where(where).orderBy(desc(expenses.expenseDate), desc(expenses.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(expenses).where(where),
    db
      .select({ category: expenses.category, amount: sql<string>`sum(${expenses.amount})` })
      .from(expenses)
      .where(and(where, eq(expenses.status, 'active')))
      .groupBy(expenses.category)
      .orderBy(desc(sql`sum(${expenses.amount})`)),
    db.selectDistinct({ category: expenses.category }).from(expenses).orderBy(asc(expenses.category)),
  ])
  const byCategory = byCat.map((c) => ({ category: c.category, amount: Number(c.amount) }))
  return {
    page,
    pageSize,
    total: n.n,
    items: rows.map(toExpense),
    totals: { total: byCategory.reduce((s, c) => s + c.amount, 0), byCategory },
    categories: cats.map((c) => c.category),
  }
}

// ---------------------------------------------------------------- cash in / out

export async function addCashMovement(db: Db, actor: Actor, input: CashMovementInput) {
  assertCan(actor, 'cash.manage')
  const data = cashMovementSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(cashMovements).values({ ...data, userId: actor.id, userName: actor.name, createdAt: Date.now() }).returning()
    await writeAudit(tx, actor, { action: `cash.${data.type}`, module: 'cash', entityId: row.id, after: data, reason: data.reason })
    return row
  })
}

// ---------------------------------------------------------------- cash book

const range = (col: Parameters<typeof gte>[0], from?: number, to?: number) => and(from !== undefined ? gte(col, from) : undefined, to !== undefined ? lt(col, to) : undefined)

/** Every money movement in [from, to) (epoch ms), optionally for one user, oldest first. */
export async function cashEvents(db: Db, f: { from?: number; to?: number; userId?: string }): Promise<CashEvent[]> {
  const byUser = <T,>(col: T) => (f.userId ? eq(col as never, f.userId) : undefined)
  const [salePay, saleCancel, pays, purch, purchCancel, sRet, pRet, exp, moves] = await Promise.all([
    db
      .select({ p: salePayments, s: sales })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(range(sales.createdAt, f.from, f.to), byUser(sales.cashierId))),
    db
      .select({ p: salePayments, s: sales })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(eq(sales.status, 'cancelled'), isNotNull(sales.cancelledAt), range(sales.cancelledAt, f.from, f.to), byUser(sales.cashierId))),
    db.select().from(payments).where(and(isNull(payments.voidedAt), range(payments.createdAt, f.from, f.to), byUser(payments.userId))),
    db.select().from(purchases).where(and(sql`${purchases.paid} > 0`, range(purchases.createdAt, f.from, f.to), byUser(purchases.userId))),
    db.select().from(purchases).where(and(eq(purchases.status, 'cancelled'), sql`${purchases.paid} > 0`, isNotNull(purchases.cancelledAt), range(purchases.cancelledAt, f.from, f.to), byUser(purchases.userId))),
    db.select().from(saleReturns).where(and(sql`${saleReturns.refund} > 0`, range(saleReturns.createdAt, f.from, f.to), byUser(saleReturns.userId))),
    db.select().from(purchaseReturns).where(and(sql`${purchaseReturns.refundReceived} > 0`, range(purchaseReturns.createdAt, f.from, f.to), byUser(purchaseReturns.userId))),
    db.select().from(expenses).where(and(eq(expenses.status, 'active'), range(expenses.createdAt, f.from, f.to), byUser(expenses.userId))),
    db.select().from(cashMovements).where(and(range(cashMovements.createdAt, f.from, f.to), byUser(cashMovements.userId))),
  ])
  const events: CashEvent[] = [
    ...salePay.filter((r) => r.p.amount > 0).map((r): CashEvent => ({ at: r.s.createdAt, kind: 'sale', direction: 'in', method: r.p.method, amount: r.p.amount, ref: r.s.invoiceNo, refId: r.s.id, userId: r.s.cashierId, userName: r.s.cashierName })),
    // A cancelled sale's money goes back to the customer.
    ...saleCancel.filter((r) => r.p.amount > 0).map((r): CashEvent => ({ at: r.s.cancelledAt!, kind: 'sale_cancel', direction: 'out', method: r.p.method, amount: r.p.amount, ref: r.s.invoiceNo, refId: r.s.id, userId: r.s.cashierId, userName: r.s.cashierName })),
    ...pays.map((p): CashEvent => ({
      at: p.createdAt,
      kind: p.kind === 'due_collection' ? 'due_collection' : 'supplier_payment',
      direction: p.direction,
      method: p.method,
      amount: p.amount,
      ref: p.paymentNo,
      refId: p.id,
      userId: p.userId,
      userName: p.userName,
      note: p.partyName,
    })),
    // Purchases record what was paid, not how: treated as cash.
    ...purch.map((p): CashEvent => ({ at: p.createdAt, kind: 'purchase', direction: 'out', method: 'cash', amount: p.paid, ref: p.purchaseNo, refId: p.id, userId: p.userId, userName: p.userName, note: p.supplierName })),
    ...purchCancel.map((p): CashEvent => ({ at: p.cancelledAt!, kind: 'purchase_cancel', direction: 'in', method: 'cash', amount: p.paid, ref: p.purchaseNo, refId: p.id, userId: p.userId, userName: p.userName, note: p.supplierName })),
    ...sRet.map((r): CashEvent => ({ at: r.createdAt, kind: 'sale_refund', direction: 'out', method: r.refundMethod ?? 'cash', amount: r.refund, ref: r.returnNo, refId: r.saleId, userId: r.userId, userName: r.userName, note: r.customerName })),
    ...pRet.map((r): CashEvent => ({ at: r.createdAt, kind: 'purchase_refund', direction: 'in', method: r.refundMethod ?? 'cash', amount: r.refundReceived, ref: r.returnNo, refId: r.purchaseId, userId: r.userId, userName: r.userName, note: r.supplierName })),
    ...exp.map((e): CashEvent => ({ at: e.createdAt, kind: 'expense', direction: 'out', method: e.method, amount: e.amount, ref: e.expenseNo, refId: e.id, userId: e.userId, userName: e.userName, note: e.category })),
    ...moves.map((m): CashEvent => ({ at: m.createdAt, kind: m.type, direction: m.type === 'cash_in' ? 'in' : 'out', method: 'cash', amount: m.amount, userId: m.userId, userName: m.userName, note: m.reason })),
  ]
  return events.sort((a, b) => a.at - b.at)
}

const net = (events: CashEvent[], method?: PaymentMethod) =>
  events.filter((e) => !method || e.method === method).reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0)

/** Cash book for a date range plus the cash the records say is in the drawer overall. */
export async function cashBook(db: Db, from: DateOnly, to: DateOnly): Promise<CashBook> {
  const [events, all] = await Promise.all([cashEvents(db, { from: startOfDateOnly(from), to: startOfDateOnly(addDays(to, 1)) }), cashEvents(db, {})])
  const byMethod = PAYMENT_METHODS.map((method) => ({
    method,
    in: events.filter((e) => e.method === method && e.direction === 'in').reduce((s, e) => s + e.amount, 0),
    out: events.filter((e) => e.method === method && e.direction === 'out').reduce((s, e) => s + e.amount, 0),
  })).filter((m) => m.in || m.out)
  return { events: events.reverse(), byMethod, cashInDrawer: net(all, 'cash') }
}

// ---------------------------------------------------------------- shifts

type ShiftRow = typeof shifts.$inferSelect

async function withFigures(db: Db, s: ShiftRow): Promise<ShiftRecord> {
  const events = await cashEvents(db, { from: s.openedAt, to: (s.closedAt ?? Date.now()) + 1, userId: s.userId })
  const cash = events.filter((e) => e.method === 'cash')
  const cashIn = cash.filter((e) => e.direction === 'in').reduce((a, e) => a + e.amount, 0)
  const cashOut = cash.filter((e) => e.direction === 'out').reduce((a, e) => a + e.amount, 0)
  const [sold] = await db
    .select({ n: count(), total: sql<string>`coalesce(sum(${sales.total}), 0)` })
    .from(sales)
    .where(and(eq(sales.cashierId, s.userId), ne(sales.status, 'cancelled'), gte(sales.createdAt, s.openedAt), lt(sales.createdAt, (s.closedAt ?? Date.now()) + 1)))
  return {
    id: s.id,
    userId: s.userId,
    userName: s.userName,
    status: s.status,
    openedAt: s.openedAt,
    openingCash: s.openingCash,
    closedAt: s.closedAt ?? undefined,
    expectedCash: s.expectedCash ?? s.openingCash + cashIn - cashOut,
    countedCash: s.countedCash ?? undefined,
    difference: s.difference ?? undefined,
    note: s.note ?? undefined,
    cashIn,
    cashOut,
    salesCount: sold.n,
    salesTotal: Number(sold.total),
  }
}

export async function currentShift(db: Db, userId: string): Promise<ShiftRecord | null> {
  const [s] = await db.select().from(shifts).where(and(eq(shifts.userId, userId), eq(shifts.status, 'open')))
  return s ? withFigures(db, s) : null
}

export async function openShift(db: Db, actor: Actor, input: { openingCash: number }): Promise<ShiftRecord> {
  assertCan(actor, 'shifts.own')
  const data = openShiftSchema.parse(input)
  const id = await db.transaction(async (tx) => {
    const settings = await getSettings(tx)
    const open = await tx.select().from(shifts).where(eq(shifts.status, 'open')).for('update')
    if (open.some((s) => s.userId === actor.id)) throw new BusinessError('conflict', 'You already have an open shift.', { key: 'shiftAlreadyOpen' })
    if (open.length > 0 && !settings.allowMultipleOpenShifts) {
      throw new BusinessError('conflict', `${open[0].userName}'s shift is still open. Close it first.`, { key: 'otherShiftOpen', values: { name: open[0].userName } })
    }
    const [row] = await tx.insert(shifts).values({ userId: actor.id, userName: actor.name, status: 'open', openedAt: Date.now(), openingCash: data.openingCash }).returning()
    await writeAudit(tx, actor, { action: 'shift.open', module: 'shifts', entityId: row.id, after: { openingCash: data.openingCash } })
    return row.id
  })
  const [row] = await db.select().from(shifts).where(eq(shifts.id, id))
  return withFigures(db, row)
}

/** Close a shift with the counted cash. Managers (shifts.all) can close anyone's shift. */
export async function closeShift(db: Db, actor: Actor, id: ID, input: { countedCash: number; note?: string }): Promise<ShiftRecord> {
  const data = closeShiftSchema.parse(input)
  const [s] = await db.select().from(shifts).where(eq(shifts.id, id))
  if (!s) throw new BusinessError('not_found', 'Shift not found.', { key: 'shiftNotFound' })
  assertCan(actor, s.userId === actor.id ? 'shifts.own' : 'shifts.all')
  if (s.status !== 'open') throw new BusinessError('conflict', 'This shift is already closed.', { key: 'shiftClosed' })
  const closedAt = Date.now()
  const figures = await withFigures(db, { ...s, closedAt })
  const expected = figures.expectedCash
  await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, id)).for('update')
    if (locked.status !== 'open') throw new BusinessError('conflict', 'This shift is already closed.', { key: 'shiftClosed' })
    await tx
      .update(shifts)
      .set({ status: 'closed', closedAt, expectedCash: expected, countedCash: data.countedCash, difference: data.countedCash - expected, note: data.note || null })
      .where(eq(shifts.id, id))
    await writeAudit(tx, actor, { action: 'shift.close', module: 'shifts', entityId: id, after: { expected, counted: data.countedCash, difference: data.countedCash - expected }, reason: data.note || undefined })
  })
  const [row] = await db.select().from(shifts).where(eq(shifts.id, id))
  return withFigures(db, row)
}

export async function listShifts(db: Db, f: { userId?: string; page?: number; pageSize?: number }): Promise<Page<ShiftRecord>> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 20))
  const where = f.userId ? eq(shifts.userId, f.userId) : undefined
  const [rows, [n]] = await Promise.all([
    db.select().from(shifts).where(where).orderBy(desc(shifts.openedAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(shifts).where(where),
  ])
  return { page, pageSize, total: n.n, items: await Promise.all(rows.map((r) => withFigures(db, r))) }
}

/** Throws when the shop requires an open shift to sell and the cashier has none. */
export async function assertShiftForSale(db: Db, actor: Actor) {
  const settings = await getSettings(db)
  if (!settings.requireShiftForSale) return
  const [s] = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.userId, actor.id), eq(shifts.status, 'open')))
  if (!s) throw new BusinessError('shift_required', 'Open your shift before selling.')
}

// ---------------------------------------------------------------- profit and loss

const LOSS_TYPES = ['damaged', 'lost', 'expired', 'adjustment_decrease', 'adjustment_increase']

/** Profit and loss for the calendar dates [from, to] in the shop timezone, from the recorded documents. */
export async function profitAndLoss(db: Db, from: DateOnly, to: DateOnly): Promise<ProfitAndLoss> {
  const start = startOfDateOnly(from)
  const end = startOfDateOnly(addDays(to, 1))
  const [[s], [r], [loss], byCat] = await Promise.all([
    db
      .select({
        n: count(),
        total: sql<string>`coalesce(sum(${sales.total}), 0)`,
        vat: sql<string>`coalesce(sum(${sales.taxTotal}), 0)`,
        cogs: sql<string>`coalesce(sum(${sales.cogs}), 0)`,
      })
      .from(sales)
      .where(and(ne(sales.status, 'cancelled'), gte(sales.createdAt, start), lt(sales.createdAt, end))),
    db
      .select({ total: sql<string>`coalesce(sum(${saleReturns.total}), 0)`, cost: sql<string>`coalesce(sum(${saleReturns.costRestocked}), 0)` })
      .from(saleReturns)
      .where(and(gte(saleReturns.createdAt, start), lt(saleReturns.createdAt, end))),
    db
      .select({ value: sql<string>`coalesce(sum(${stockMovements.valueChange}), 0)` })
      .from(stockMovements)
      .where(and(inArray(stockMovements.type, LOSS_TYPES), gte(stockMovements.createdAt, start), lt(stockMovements.createdAt, end))),
    db
      .select({ category: expenses.category, amount: sql<string>`sum(${expenses.amount})` })
      .from(expenses)
      .where(and(eq(expenses.status, 'active'), gte(expenses.expenseDate, from), sql`${expenses.expenseDate} <= ${to}`))
      .groupBy(expenses.category)
      .orderBy(desc(sql`sum(${expenses.amount})`)),
  ])
  const vat = Number(s.vat)
  const salesNet = Number(s.total) - vat
  const returns = Number(r.total)
  const netSales = salesNet - returns
  const costOfGoods = Number(s.cogs) - Number(r.cost)
  const grossProfit = netSales - costOfGoods
  const stockLoss = -Number(loss.value)
  const expensesByCategory = byCat.map((c) => ({ category: c.category, amount: Number(c.amount) }))
  const expenseTotal = expensesByCategory.reduce((a, c) => a + c.amount, 0)
  return {
    from,
    to,
    sales: salesNet,
    vat,
    salesCount: s.n,
    returns,
    netSales,
    costOfGoods,
    grossProfit,
    stockLoss,
    expenses: expenseTotal,
    expensesByCategory,
    netProfit: grossProfit - stockLoss - expenseTotal,
  }
}
