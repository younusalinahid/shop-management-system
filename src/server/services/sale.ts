import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { DateOnly, ID } from '@/types/db'
import { addDays, startOfDateOnly } from '@/lib/datetime'
import { BusinessError } from '@/lib/errors'
import { cancelSchema, type Page } from '@/lib/inventory'
import { can } from '@/lib/permissions'
import {
  computeSale,
  type HeldSale,
  holdSchema,
  type SaleDetail,
  saleInputSchema,
  type SaleInput,
  type SaleLine,
  type SaleStatus,
  type SaleSummary,
  settle,
  unitPriceFor,
} from '@/lib/sales'
import type { Db } from '../db'
import { customers, heldSales, saleItems, salePayments, sales } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'
import { lockProduct, quantityToBase, restock, stockOut, type StockOutResult, unitOfProduct } from './inventory'
import { getSettings } from './settings'

/**
 * SalesService. Completing a sale is one transaction: the invoice, its lines (snapshots of name, unit,
 * price and cost), stock out per line (FEFO batches, weighted-average cost), payments, the customer's
 * due and the audit record. If any stock check fails, nothing is saved. Completed sales are never
 * edited or deleted; cancelling puts the stock back with reversing movements.
 */

type SaleRow = typeof sales.$inferSelect
type ItemRow = typeof saleItems.$inferSelect

const toSummary = (r: SaleRow, itemCount: number): SaleSummary => ({
  id: r.id,
  invoiceNo: r.invoiceNo,
  customerId: r.customerId ?? undefined,
  customerName: r.customerName,
  customerPhone: r.customerPhone ?? undefined,
  cashierName: r.cashierName,
  priceMode: r.priceMode,
  status: r.status,
  subtotal: r.subtotal,
  itemDiscountTotal: r.itemDiscountTotal,
  invoiceDiscount: r.invoiceDiscount,
  taxTotal: r.taxTotal,
  total: r.total,
  paid: r.paid,
  due: r.due,
  changeGiven: r.changeGiven,
  cogs: r.cogs,
  itemCount,
  note: r.note ?? undefined,
  cancelledAt: r.cancelledAt ?? undefined,
  cancelReason: r.cancelReason ?? undefined,
  createdAt: r.createdAt,
})

const toLine = (r: ItemRow): SaleLine => ({
  id: r.id,
  productId: r.productId,
  productName: r.productName,
  sku: r.sku,
  unitName: r.unitName,
  unitFactor: r.unitFactor,
  quantity: r.quantity,
  baseQty: r.baseQty,
  unitPrice: r.unitPrice,
  amount: r.amount,
  discount: r.discount,
  invoiceDiscount: r.invoiceDiscount,
  taxRate: r.taxRate,
  tax: r.tax,
  lineTotal: r.lineTotal,
  costTotal: r.costTotal,
})

async function byIdempotencyKey(db: Db, key: string): Promise<SaleDetail | null> {
  const [row] = await db.select({ id: sales.id }).from(sales).where(eq(sales.idempotencyKey, key))
  return row ? getSale(db, row.id) : null
}

export async function createSale(db: Db, actor: Actor, input: SaleInput): Promise<SaleDetail> {
  assertCan(actor, 'pos.sell')
  const data = saleInputSchema.parse(input)
  // A double click or a retried request returns the sale that was already saved.
  const existing = await byIdempotencyKey(db, data.idempotencyKey)
  if (existing) return existing

  try {
    const id = await db.transaction(async (tx) => {
      const settings = await getSettings(tx)
      let customer: typeof customers.$inferSelect | undefined
      if (data.customerId) {
        ;[customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId)).for('update')
        if (!customer) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
        if (customer.status !== 'active') throw new BusinessError('archived', `Customer “${customer.name}” is archived.`, { key: 'customerArchived', values: { name: customer.name } })
      }

      const mayChangePrice = can(actor.role, 'products.edit_price')
      const lines = []
      for (const item of data.items) {
        const product = await lockProduct(tx, item.productId)
        if (product.status !== 'active') throw new BusinessError('archived', `“${product.name}” is archived.`, { key: 'productArchivedNamed', values: { name: product.name } })
        const unit = await unitOfProduct(tx, product.id, item.unitId)
        if (!unit.canSell) throw new BusinessError('invalid_unit', `${product.name} is not sold by the ${unit.name}.`, { key: 'unitNotSellable', values: { name: product.name, unit: unit.name } })
        const listPrice = unitPriceFor(unit, data.priceMode)
        if (item.unitPrice !== listPrice && !mayChangePrice) {
          throw new BusinessError('forbidden', `You may not change the price of ${product.name}.`, { key: 'priceLocked', values: { name: product.name } })
        }
        lines.push({ item, product, unit, baseQty: quantityToBase(item.quantity, unit, product) })
      }

      const calc = computeSale(
        lines.map((l) => ({ quantity: l.item.quantity, unitPrice: l.item.unitPrice, discount: l.item.discount, taxRate: l.product.taxRate })),
        data.invoiceDiscount,
        settings.pricesIncludeTax,
      )
      lines.forEach((l, i) => {
        if (l.item.discount > calc.lines[i].amount) {
          throw new BusinessError('invalid', `The discount on ${l.product.name} is more than its price.`, { key: 'lineDiscountTooLarge', values: { name: l.product.name } })
        }
      })
      if (data.invoiceDiscount > calc.invoiceDiscount) throw new BusinessError('invalid', 'The discount is larger than the sale amount.', { key: 'saleDiscountTooLarge' })

      const pay = settle(calc.total, data.payments)
      if (pay.nonCashTooMuch) throw new BusinessError('overpaid', 'Card and mobile payments cannot be more than the total (only cash can get change).', { key: 'nonCashOverpaid' })
      if (pay.due > 0 && !customer) throw new BusinessError('due_needs_customer', 'Select a customer to sell on credit (due).')

      const now = Date.now()
      const invoiceNo = formatDocNo(settings.invoicePrefix, await nextCounter(tx, 'sale'))
      const [sale] = await tx
        .insert(sales)
        .values({
          invoiceNo,
          idempotencyKey: data.idempotencyKey,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? '',
          customerPhone: customer?.phone ?? null,
          cashierId: actor.id,
          cashierName: actor.name,
          priceMode: data.priceMode,
          status: 'completed',
          subtotal: calc.subtotal,
          itemDiscountTotal: calc.itemDiscountTotal,
          invoiceDiscount: calc.invoiceDiscount,
          taxTotal: calc.taxTotal,
          total: calc.total,
          paid: pay.paid,
          due: pay.due,
          changeGiven: pay.change,
          cogs: 0,
          note: data.note || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: sales.id })

      let cogs = 0
      for (const [i, l] of lines.entries()) {
        const out = await stockOut(tx, actor, {
          productId: l.product.id,
          type: 'sale',
          qty: l.baseQty,
          allowNegative: settings.allowNegativeStock,
          // Expired batches are not sold unless the shop allows it in settings.
          skipExpired: l.product.trackExpiry && !settings.allowExpiredSale,
          refType: 'sale',
          refId: sale.id,
          reason: invoiceNo,
        })
        cogs += out.value
        const c = calc.lines[i]
        await tx.insert(saleItems).values({
          saleId: sale.id,
          productId: l.product.id,
          productName: l.product.name,
          sku: l.product.sku,
          unitId: l.unit.id,
          unitName: l.unit.name,
          unitFactor: l.unit.factor,
          quantity: l.item.quantity,
          baseQty: l.baseQty,
          unitPrice: l.item.unitPrice,
          amount: c.amount,
          discount: c.discount,
          invoiceDiscount: c.invoiceDiscount,
          taxRate: l.product.taxRate,
          tax: c.tax,
          lineTotal: c.lineTotal,
          costTotal: out.value,
          allocations: out.allocations,
          sortOrder: i,
          createdAt: now,
        })
      }
      await tx.update(sales).set({ cogs }).where(eq(sales.id, sale.id))

      const payRows = data.payments.map((p, i) => ({ saleId: sale.id, method: p.method, amount: pay.kept[i], tendered: p.amount, reference: p.reference || null, createdAt: now })).filter((p) => p.tendered > 0)
      if (payRows.length) await tx.insert(salePayments).values(payRows)
      if (customer && pay.due > 0) {
        await tx
          .update(customers)
          .set({ balance: sql`${customers.balance} + ${pay.due}`, updatedAt: now })
          .where(eq(customers.id, customer.id))
      }
      await writeAudit(tx, actor, {
        action: 'sale.create',
        module: 'sales',
        entityId: sale.id,
        after: {
          invoiceNo,
          customer: customer?.name,
          total: calc.total,
          paid: pay.paid,
          due: pay.due,
          items: lines.map((l) => ({ product: l.product.name, qty: `${l.item.quantity} ${l.unit.name}`, price: l.item.unitPrice })),
        },
      })
      return sale.id
    })
    return (await getSale(db, id))!
  } catch (e) {
    // Two identical requests at the same moment: the loser hits the unique key and returns the winner.
    const again = await byIdempotencyKey(db, data.idempotencyKey)
    if (again) return again
    throw e
  }
}

/** Cancel a sale: stock goes back to the batches it came from, at the cost it left with; the customer due is removed. */
export async function cancelSale(db: Db, actor: Actor, id: ID, input: { reason: string }): Promise<SaleDetail> {
  assertCan(actor, 'sales.cancel')
  const { reason } = cancelSchema.parse(input)
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, id)).for('update')
    if (!s) throw new BusinessError('not_found', 'Sale not found.', { key: 'saleNotFound' })
    if (s.status !== 'completed') throw new BusinessError('conflict', 'Only a completed sale without returns can be cancelled.', { key: 'cannotCancelSale' })
    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, id)).orderBy(asc(saleItems.sortOrder))
    for (const item of items) {
      await restock(tx, actor, {
        productId: item.productId,
        type: 'sale_cancel',
        allocations: item.allocations as StockOutResult['allocations'],
        refType: 'sale',
        refId: id,
        reason: `${s.invoiceNo}: ${reason}`,
      })
    }
    const now = Date.now()
    if (s.customerId && s.due > 0) {
      await tx
        .update(customers)
        .set({ balance: sql`${customers.balance} - ${s.due}`, updatedAt: now })
        .where(eq(customers.id, s.customerId))
    }
    await tx.update(sales).set({ status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now }).where(eq(sales.id, id))
    await writeAudit(tx, actor, { action: 'sale.cancel', module: 'sales', entityId: id, before: { status: s.status, total: s.total, due: s.due }, after: { status: 'cancelled' }, reason })
  })
  return (await getSale(db, id))!
}

export async function getSale(db: Db, id: ID): Promise<SaleDetail | null> {
  const [row] = await db.select().from(sales).where(eq(sales.id, id))
  if (!row) return null
  const [items, payments] = await Promise.all([
    db.select().from(saleItems).where(eq(saleItems.saleId, id)).orderBy(asc(saleItems.sortOrder)),
    db.select().from(salePayments).where(eq(salePayments.saleId, id)).orderBy(asc(salePayments.createdAt)),
  ])
  return {
    ...toSummary(row, items.length),
    items: items.map(toLine),
    payments: payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference ?? undefined })),
  }
}

export interface SaleFilter {
  q?: string
  status?: SaleStatus
  customerId?: ID
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listSales(db: Db, f: SaleFilter): Promise<Page<SaleSummary> & { totals: { total: number; paid: number; due: number; count: number } }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const q = f.q?.trim()
  const conds: Array<SQL | undefined> = [
    f.status ? eq(sales.status, f.status) : undefined,
    f.customerId ? eq(sales.customerId, f.customerId) : undefined,
    f.from ? gte(sales.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(sales.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
  ]
  if (q) {
    const withProduct = db.select({ id: saleItems.saleId }).from(saleItems).where(ilike(saleItems.productName, `%${q}%`))
    conds.push(or(ilike(sales.invoiceNo, `%${q}%`), ilike(sales.customerName, `%${q}%`), ilike(sales.customerPhone, `%${q}%`), inArray(sales.id, withProduct)))
  }
  const where = and(...conds)
  const live = sql`${sales.status} <> 'cancelled'`
  const [rows, [agg]] = await Promise.all([
    db.select().from(sales).where(where).orderBy(desc(sales.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({
        n: count(),
        // Cancelled sales don't count towards money totals.
        live: sql<string>`count(*) filter (where ${live})`,
        total: sql<string>`coalesce(sum(${sales.total}) filter (where ${live}), 0)`,
        paid: sql<string>`coalesce(sum(${sales.paid}) filter (where ${live}), 0)`,
        due: sql<string>`coalesce(sum(${sales.due}) filter (where ${live}), 0)`,
      })
      .from(sales)
      .where(where),
  ])
  const counts = rows.length
    ? await db
        .select({ id: saleItems.saleId, n: count() })
        .from(saleItems)
        .where(inArray(saleItems.saleId, rows.map((r) => r.id)))
        .groupBy(saleItems.saleId)
    : []
  const byId = new Map(counts.map((c) => [c.id, c.n]))
  return {
    page,
    pageSize,
    total: agg.n,
    totals: { count: Number(agg.live), total: Number(agg.total), paid: Number(agg.paid), due: Number(agg.due) },
    items: rows.map((r) => toSummary(r, byId.get(r.id) ?? 0)),
  }
}

/** Today's figures for the dashboard (shop timezone), cancelled sales excluded. */
export async function salesBetween(db: Db, from: number, to: number) {
  const [r] = await db
    .select({
      n: count(),
      total: sql<string>`coalesce(sum(${sales.total}), 0)`,
      due: sql<string>`coalesce(sum(${sales.due}), 0)`,
      cogs: sql<string>`coalesce(sum(${sales.cogs}), 0)`,
    })
    .from(sales)
    .where(and(gte(sales.createdAt, from), lt(sales.createdAt, to), sql`${sales.status} <> 'cancelled'`))
  return { count: r.n, total: Number(r.total), due: Number(r.due), cogs: Number(r.cogs) }
}

// ---------------------------------------------------------------- held sales

export async function listHeld(db: Db): Promise<HeldSale[]> {
  const rows = await db.select().from(heldSales).orderBy(desc(heldSales.createdAt))
  return rows.map((r) => ({ id: r.id, label: r.label, userName: r.userName, cart: r.cart, createdAt: r.createdAt }))
}

export async function holdSale(db: Db, actor: Actor, input: { label: string; cart?: unknown }): Promise<HeldSale> {
  assertCan(actor, 'pos.sell')
  const data = holdSchema.parse(input)
  const now = Date.now()
  const [r] = await db
    .insert(heldSales)
    .values({ label: data.label, cart: data.cart ?? {}, userId: actor.id, userName: actor.name, createdAt: now, updatedAt: now })
    .returning()
  return { id: r.id, label: r.label, userName: r.userName, cart: r.cart, createdAt: r.createdAt }
}

export async function deleteHeld(db: Db, actor: Actor, id: ID): Promise<void> {
  assertCan(actor, 'pos.sell')
  await db.delete(heldSales).where(eq(heldSales.id, id))
}
