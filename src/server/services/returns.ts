import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import type { DateOnly, ID } from '@/types/db'
import { addDays, startOfDateOnly } from '@/lib/datetime'
import { divRound } from '@/lib/decimal'
import { BusinessError } from '@/lib/errors'
import type { Page } from '@/lib/inventory'
import { purchaseReturnSchema, type PurchaseReturnInput, type PurchaseReturnRecord, saleReturnSchema, type SaleReturnInput, type SaleReturnRecord } from '@/lib/parties'
import { fromBaseQty, toBaseQty, UnitError } from '@/lib/units'
import type { Db } from '../db'
import { customers, products, purchaseItems, purchaseReturnItems, purchaseReturns, purchases, saleItems, saleReturnItems, saleReturns, sales, suppliers } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'
import { restock, stockOut, type StockOutResult } from './inventory'

/**
 * ReturnService. A return always starts from the original invoice or purchase, can never exceed what
 * is left on a line (sold/purchased − already returned), and runs in one transaction with its stock
 * change, the party balance and the audit record.
 *
 * - Sale return: resalable goods go back to the batches they came from at their original cost;
 *   damaged goods do not return to sellable stock. The money first reduces the customer's due; the rest
 *   is refunded.
 * - Purchase return: stock leaves from the batch the purchase created, at its landed cost. The amount
 *   first reduces what the shop owes the supplier; the rest is a refund received.
 */

function returnQty(quantity: string, unit: { unitName: string; unitFactor: number }, allowFraction: boolean, name: string): number {
  try {
    return toBaseQty(quantity, { name: unit.unitName, factor: unit.unitFactor }, allowFraction)
  } catch (e) {
    if (e instanceof UnitError) throw new BusinessError('invalid_quantity', `${name}: ${e.message}`, { key: 'badQuantity', values: { name, qty: quantity, unit: unit.unitName } })
    throw e
  }
}

/** Share of a line's money for `qty` of `total` units; the last return takes exactly what is left. */
const share = (lineMoney: number, alreadyReturned: number, qty: number, lineQty: number, remainingQty: number) =>
  qty === remainingQty ? lineMoney - alreadyReturned : divRound(BigInt(lineMoney) * BigInt(qty), BigInt(lineQty))

function tooMuch(name: string, remaining: number, unit: { unitName: string; unitFactor: number }) {
  return new BusinessError('return_too_much', `Only ${fromBaseQty(remaining, { name: unit.unitName, factor: unit.unitFactor })} ${unit.unitName} of “${name}” can still be returned.`, {
    values: { name, qty: fromBaseQty(remaining, { name: unit.unitName, factor: unit.unitFactor }), unit: unit.unitName },
  })
}

/**
 * The part of a sale line's stock allocations that this return covers: skip what earlier returns
 * already took (first in, first back), then take `qty`, with values summing exactly to `cost`.
 */
function returnAllocations(allocations: StockOutResult['allocations'], skip: number, qty: number, cost: number) {
  const out: StockOutResult['allocations'] = []
  let toSkip = skip
  let left = qty
  for (const a of allocations) {
    if (left === 0) break
    const avail = a.qty - Math.min(a.qty, toSkip)
    toSkip = Math.max(0, toSkip - a.qty)
    if (avail <= 0) continue
    const take = Math.min(avail, left)
    out.push({ batchId: a.batchId, qty: take, value: a.qty === 0 ? 0 : divRound(BigInt(a.value) * BigInt(take), BigInt(a.qty)) })
    left -= take
  }
  if (left > 0) out.push({ qty: left, value: 0 })
  // Rounding: make the pieces add up to the cost being restocked.
  const diff = cost - out.reduce((s, a) => s + a.value, 0)
  if (out.length) out[out.length - 1].value += diff
  return out
}

// ---------------------------------------------------------------- sale returns

export async function createSaleReturn(db: Db, actor: Actor, input: SaleReturnInput): Promise<SaleReturnRecord> {
  assertCan(actor, 'returns.process')
  const data = saleReturnSchema.parse(input)
  const [dup] = await db.select({ id: saleReturns.id }).from(saleReturns).where(eq(saleReturns.idempotencyKey, data.idempotencyKey))
  if (dup) return (await getSaleReturn(db, dup.id))!

  const id = await db.transaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, data.saleId)).for('update')
    if (!sale) throw new BusinessError('not_found', 'Sale not found.', { key: 'saleNotFound' })
    if (sale.status === 'cancelled' || sale.status === 'returned') throw new BusinessError('conflict', 'Nothing on this invoice can be returned.', { key: 'nothingToReturn' })
    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).for('update')
    const byId = new Map(items.map((i) => [i.id, i]))
    if (new Set(data.items.map((i) => i.saleItemId)).size !== data.items.length) throw new BusinessError('invalid', 'A product is listed twice.', { key: 'lineTwice' })

    const now = Date.now()
    const returnNo = formatDocNo('SR-', await nextCounter(tx, 'saleReturn'))
    const [ret] = await tx
      .insert(saleReturns)
      .values({
        returnNo,
        idempotencyKey: data.idempotencyKey,
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        customerId: sale.customerId,
        customerName: sale.customerName,
        total: 0,
        dueAdjusted: 0,
        refund: 0,
        refundMethod: null,
        costRestocked: 0,
        reason: data.reason,
        userId: actor.id,
        userName: actor.name,
        createdAt: now,
      })
      .returning({ id: saleReturns.id })

    let total = 0
    let costRestocked = 0
    for (const line of data.items) {
      const item = byId.get(line.saleItemId)
      if (!item) throw new BusinessError('invalid', 'That line is not on this invoice.', { key: 'notOnInvoice' })
      const [product] = await tx.select({ allowFraction: products.allowFraction }).from(products).where(eq(products.id, item.productId))
      const qty = returnQty(line.quantity, item, product.allowFraction, item.productName)
      const remaining = item.baseQty - item.returnedBaseQty
      if (qty > remaining) throw tooMuch(item.productName, remaining, item)
      const [prior] = await tx
        .select({ amount: sql<string>`coalesce(sum(${saleReturnItems.amount}), 0)`, cost: sql<string>`coalesce(sum(${saleReturnItems.cost}), 0)` })
        .from(saleReturnItems)
        .where(eq(saleReturnItems.saleItemId, item.id))
      const amount = share(item.lineTotal, Number(prior.amount), qty, item.baseQty, remaining)
      const cost = share(item.costTotal, Number(prior.cost), qty, item.baseQty, remaining)
      if (line.condition === 'resalable') {
        await restock(tx, actor, {
          productId: item.productId,
          type: 'sale_return',
          allocations: returnAllocations(item.allocations as StockOutResult['allocations'], item.returnedBaseQty, qty, cost),
          refType: 'sale_return',
          refId: ret.id,
          reason: `${returnNo} (${sale.invoiceNo}): ${data.reason}`,
        })
        costRestocked += cost
      }
      await tx.update(saleItems).set({ returnedBaseQty: item.returnedBaseQty + qty }).where(eq(saleItems.id, item.id))
      item.returnedBaseQty += qty
      await tx.insert(saleReturnItems).values({
        returnId: ret.id,
        saleItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        unitName: item.unitName,
        unitFactor: item.unitFactor,
        quantity: line.quantity,
        baseQty: qty,
        amount,
        cost,
        condition: line.condition,
        createdAt: now,
      })
      total += amount
    }

    // The money first clears the customer's due; the rest is paid back.
    let dueAdjusted = 0
    if (sale.customerId) {
      const [c] = await tx.select().from(customers).where(eq(customers.id, sale.customerId)).for('update')
      dueAdjusted = Math.min(total, Math.max(0, c.balance))
      if (dueAdjusted > 0) await tx.update(customers).set({ balance: sql`${customers.balance} - ${dueAdjusted}`, updatedAt: now }).where(eq(customers.id, c.id))
    }
    const refund = total - dueAdjusted
    await tx
      .update(saleReturns)
      .set({ total, dueAdjusted, refund, refundMethod: refund > 0 ? data.refundMethod : null, costRestocked })
      .where(eq(saleReturns.id, ret.id))
    const allBack = items.every((i) => i.returnedBaseQty >= i.baseQty)
    await tx.update(sales).set({ status: allBack ? 'returned' : 'partially_returned', updatedAt: now }).where(eq(sales.id, sale.id))
    await writeAudit(tx, actor, {
      action: 'sale.return',
      module: 'returns',
      entityId: ret.id,
      after: { returnNo, invoiceNo: sale.invoiceNo, total, dueAdjusted, refund, items: data.items.map((l) => ({ ...l, product: byId.get(l.saleItemId)?.productName })) },
      reason: data.reason,
    })
    return ret.id
  })
  return (await getSaleReturn(db, id))!
}

export async function getSaleReturn(db: Db, id: ID): Promise<SaleReturnRecord | null> {
  const [r] = await db.select().from(saleReturns).where(eq(saleReturns.id, id))
  if (!r) return null
  const items = await db.select().from(saleReturnItems).where(eq(saleReturnItems.returnId, id))
  return toSaleReturn(r, items)
}

function toSaleReturn(r: typeof saleReturns.$inferSelect, items: Array<typeof saleReturnItems.$inferSelect>): SaleReturnRecord {
  return {
    id: r.id,
    returnNo: r.returnNo,
    saleId: r.saleId,
    invoiceNo: r.invoiceNo,
    customerName: r.customerName,
    total: r.total,
    dueAdjusted: r.dueAdjusted,
    refund: r.refund,
    refundMethod: r.refundMethod ?? undefined,
    reason: r.reason,
    userName: r.userName,
    createdAt: r.createdAt,
    items: items.map((i) => ({ id: i.id, productName: i.productName, unitName: i.unitName, quantity: i.quantity, amount: i.amount, condition: i.condition })),
  }
}

export interface ReturnFilter {
  q?: string
  from?: DateOnly
  to?: DateOnly
  docId?: ID
  page?: number
  pageSize?: number
}

export async function listSaleReturns(db: Db, f: ReturnFilter): Promise<Page<SaleReturnRecord> & { totals: { total: number; refund: number } }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const q = f.q?.trim()
  const where = and(
    f.docId ? eq(saleReturns.saleId, f.docId) : undefined,
    q ? or(ilike(saleReturns.returnNo, `%${q}%`), ilike(saleReturns.invoiceNo, `%${q}%`), ilike(saleReturns.customerName, `%${q}%`)) : undefined,
    f.from ? gte(saleReturns.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(saleReturns.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
  )
  const [rows, [agg]] = await Promise.all([
    db.select().from(saleReturns).where(where).orderBy(desc(saleReturns.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({ n: count(), total: sql<string>`coalesce(sum(${saleReturns.total}), 0)`, refund: sql<string>`coalesce(sum(${saleReturns.refund}), 0)` })
      .from(saleReturns)
      .where(where),
  ])
  const items = rows.length ? await db.select().from(saleReturnItems).where(inArray(saleReturnItems.returnId, rows.map((r) => r.id))).orderBy(asc(saleReturnItems.createdAt)) : []
  return {
    page,
    pageSize,
    total: agg.n,
    totals: { total: Number(agg.total), refund: Number(agg.refund) },
    items: rows.map((r) => toSaleReturn(r, items.filter((i) => i.returnId === r.id))),
  }
}

// ---------------------------------------------------------------- purchase returns

export async function createPurchaseReturn(db: Db, actor: Actor, input: PurchaseReturnInput): Promise<PurchaseReturnRecord> {
  assertCan(actor, 'purchases.manage')
  const data = purchaseReturnSchema.parse(input)
  const [dup] = await db.select({ id: purchaseReturns.id }).from(purchaseReturns).where(eq(purchaseReturns.idempotencyKey, data.idempotencyKey))
  if (dup) return (await getPurchaseReturn(db, dup.id))!

  const id = await db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, data.purchaseId)).for('update')
    if (!purchase) throw new BusinessError('not_found', 'Purchase not found.', { key: 'purchaseNotFound' })
    if (purchase.status === 'cancelled' || purchase.status === 'returned') throw new BusinessError('conflict', 'Nothing on this purchase can be returned.', { key: 'nothingToReturn' })
    const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, purchase.id)).for('update')
    const byId = new Map(items.map((i) => [i.id, i]))
    if (new Set(data.items.map((i) => i.purchaseItemId)).size !== data.items.length) throw new BusinessError('invalid', 'A product is listed twice.', { key: 'lineTwice' })

    const now = Date.now()
    const returnNo = formatDocNo('PR-', await nextCounter(tx, 'purchaseReturn'))
    const [ret] = await tx
      .insert(purchaseReturns)
      .values({
        returnNo,
        idempotencyKey: data.idempotencyKey,
        purchaseId: purchase.id,
        purchaseNo: purchase.purchaseNo,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplierName,
        total: 0,
        payableAdjusted: 0,
        refundReceived: 0,
        refundMethod: null,
        reason: data.reason,
        userId: actor.id,
        userName: actor.name,
        createdAt: now,
      })
      .returning({ id: purchaseReturns.id })

    let total = 0
    for (const line of data.items) {
      const item = byId.get(line.purchaseItemId)
      if (!item) throw new BusinessError('invalid', 'That line is not on this purchase.', { key: 'notOnInvoice' })
      const [product] = await tx.select({ allowFraction: products.allowFraction }).from(products).where(eq(products.id, item.productId))
      const qty = returnQty(line.quantity, item, product.allowFraction, item.productName)
      const remaining = item.baseQty - item.returnedBaseQty
      if (qty > remaining) throw tooMuch(item.productName, remaining, item)
      const [prior] = await tx.select({ amount: sql<string>`coalesce(sum(${purchaseReturnItems.amount}), 0)` }).from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseItemId, item.id))
      const amount = share(item.lineTotal, Number(prior.amount), qty, item.baseQty, remaining)
      try {
        await stockOut(tx, actor, {
          productId: item.productId,
          type: 'purchase_return',
          qty,
          batchId: item.batchId ?? undefined,
          exactValue: amount,
          allowNegative: false,
          refType: 'purchase_return',
          refId: ret.id,
          reason: `${returnNo} (${purchase.purchaseNo}): ${data.reason}`,
        })
      } catch (e) {
        if (e instanceof BusinessError && e.code === 'insufficient_stock') {
          throw new BusinessError('stock_used', `Cannot return: part of “${item.productName}” from this purchase was already sold or written off.`, { values: { name: item.productName } })
        }
        throw e
      }
      await tx.update(purchaseItems).set({ returnedBaseQty: item.returnedBaseQty + qty }).where(eq(purchaseItems.id, item.id))
      item.returnedBaseQty += qty
      await tx.insert(purchaseReturnItems).values({
        returnId: ret.id,
        purchaseItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        unitName: item.unitName,
        unitFactor: item.unitFactor,
        quantity: line.quantity,
        baseQty: qty,
        amount,
        createdAt: now,
      })
      total += amount
    }

    let payableAdjusted = 0
    if (purchase.supplierId) {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, purchase.supplierId)).for('update')
      payableAdjusted = Math.min(total, Math.max(0, s.balance))
      if (payableAdjusted > 0) await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${payableAdjusted}`, updatedAt: now }).where(eq(suppliers.id, s.id))
    }
    const refundReceived = total - payableAdjusted
    await tx
      .update(purchaseReturns)
      .set({ total, payableAdjusted, refundReceived, refundMethod: refundReceived > 0 ? data.refundMethod : null })
      .where(eq(purchaseReturns.id, ret.id))
    const allBack = items.every((i) => i.returnedBaseQty >= i.baseQty)
    await tx.update(purchases).set({ status: allBack ? 'returned' : 'partially_returned', updatedAt: now }).where(eq(purchases.id, purchase.id))
    await writeAudit(tx, actor, {
      action: 'purchase.return',
      module: 'returns',
      entityId: ret.id,
      after: { returnNo, purchaseNo: purchase.purchaseNo, total, payableAdjusted, refundReceived },
      reason: data.reason,
    })
    return ret.id
  })
  return (await getPurchaseReturn(db, id))!
}

export async function getPurchaseReturn(db: Db, id: ID): Promise<PurchaseReturnRecord | null> {
  const [r] = await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, id))
  if (!r) return null
  const items = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.returnId, id))
  return toPurchaseReturn(r, items)
}

function toPurchaseReturn(r: typeof purchaseReturns.$inferSelect, items: Array<typeof purchaseReturnItems.$inferSelect>): PurchaseReturnRecord {
  return {
    id: r.id,
    returnNo: r.returnNo,
    purchaseId: r.purchaseId,
    purchaseNo: r.purchaseNo,
    supplierName: r.supplierName,
    total: r.total,
    payableAdjusted: r.payableAdjusted,
    refundReceived: r.refundReceived,
    refundMethod: r.refundMethod ?? undefined,
    reason: r.reason,
    userName: r.userName,
    createdAt: r.createdAt,
    items: items.map((i) => ({ id: i.id, productName: i.productName, unitName: i.unitName, quantity: i.quantity, amount: i.amount })),
  }
}

export async function listPurchaseReturns(db: Db, f: ReturnFilter): Promise<Page<PurchaseReturnRecord> & { totals: { total: number; refund: number } }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const q = f.q?.trim()
  const where = and(
    f.docId ? eq(purchaseReturns.purchaseId, f.docId) : undefined,
    q ? or(ilike(purchaseReturns.returnNo, `%${q}%`), ilike(purchaseReturns.purchaseNo, `%${q}%`), ilike(purchaseReturns.supplierName, `%${q}%`)) : undefined,
    f.from ? gte(purchaseReturns.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(purchaseReturns.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
  )
  const [rows, [agg]] = await Promise.all([
    db.select().from(purchaseReturns).where(where).orderBy(desc(purchaseReturns.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({ n: count(), total: sql<string>`coalesce(sum(${purchaseReturns.total}), 0)`, refund: sql<string>`coalesce(sum(${purchaseReturns.refundReceived}), 0)` })
      .from(purchaseReturns)
      .where(where),
  ])
  const items = rows.length ? await db.select().from(purchaseReturnItems).where(inArray(purchaseReturnItems.returnId, rows.map((r) => r.id))) : []
  return {
    page,
    pageSize,
    total: agg.n,
    totals: { total: Number(agg.total), refund: Number(agg.refund) },
    items: rows.map((r) => toPurchaseReturn(r, items.filter((i) => i.returnId === r.id))),
  }
}
