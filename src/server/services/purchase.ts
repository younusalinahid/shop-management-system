import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import type { DateOnly, ID } from '@/types/db'
import { BusinessError } from '@/lib/errors'
import {
  cancelSchema,
  type Page,
  type PurchaseDetail,
  purchaseInputSchema,
  type PurchaseInput,
  type PurchaseLine,
  type PurchaseSummary,
  purchaseTotals,
} from '@/lib/inventory'
import type { Db } from '../db'
import { products, productUnits, purchaseItems, purchases, suppliers } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'
import { lockProduct, quantityToBase, stockIn, stockOut, unitOfProduct } from './inventory'
import { getSettings } from './settings'

/**
 * PurchaseService. Saving a purchase is one transaction: the purchase, its lines (with snapshots),
 * stock in for every line (with batches), the unit's last cost, the supplier's payable and the audit
 * record. Anything failing rolls all of it back. Completed purchases are never edited or deleted;
 * cancelling writes reversing stock movements instead.
 */

type PurchaseRow = typeof purchases.$inferSelect
type ItemRow = typeof purchaseItems.$inferSelect

const toSummary = (r: PurchaseRow, itemCount: number): PurchaseSummary => ({
  id: r.id,
  purchaseNo: r.purchaseNo,
  supplierId: r.supplierId ?? undefined,
  supplierName: r.supplierName,
  referenceNo: r.referenceNo ?? undefined,
  purchaseDate: r.purchaseDate,
  status: r.status,
  subtotal: r.subtotal,
  discount: r.discount,
  additionalCost: r.additionalCost,
  total: r.total,
  paid: r.paid,
  due: r.due,
  itemCount,
  userName: r.userName,
  note: r.note ?? undefined,
  cancelledAt: r.cancelledAt ?? undefined,
  cancelReason: r.cancelReason ?? undefined,
  createdAt: r.createdAt,
})

const toLine = (r: ItemRow, baseUnitName: string): PurchaseLine => ({
  baseUnitName,
  id: r.id,
  productId: r.productId,
  productName: r.productName,
  sku: r.sku,
  unitName: r.unitName,
  unitFactor: r.unitFactor,
  quantity: r.quantity,
  baseQty: r.baseQty,
  unitCost: r.unitCost,
  amount: r.amount,
  lineTotal: r.lineTotal,
  batchNo: r.batchNo ?? undefined,
  expiryDate: r.expiryDate ?? undefined,
})

async function byIdempotencyKey(db: Db, key: string): Promise<PurchaseDetail | null> {
  const [row] = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.idempotencyKey, key))
  return row ? getPurchase(db, row.id) : null
}

export async function createPurchase(db: Db, actor: Actor, input: PurchaseInput): Promise<PurchaseDetail> {
  assertCan(actor, 'purchases.manage')
  const data = purchaseInputSchema.parse(input)
  // A retried click (slow network, double submit) returns the purchase that was already saved.
  const existing = await byIdempotencyKey(db, data.idempotencyKey)
  if (existing) return existing

  try {
    const id = await db.transaction(async (tx) => {
      const settings = await getSettings(tx)
      let supplierName = ''
      if (data.supplierId) {
        const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, data.supplierId)).for('update')
        if (!s) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
        if (s.status !== 'active') throw new BusinessError('archived', `Supplier “${s.name}” is archived.`, { key: 'supplierArchived', values: { name: s.name } })
        supplierName = s.name
      }

      // Resolve every line: product, unit, exact base quantity.
      const lines = []
      for (const item of data.items) {
        const product = await lockProduct(tx, item.productId)
        if (product.status !== 'active') throw new BusinessError('archived', `“${product.name}” is archived.`, { key: 'productArchivedNamed', values: { name: product.name } })
        const unit = await unitOfProduct(tx, product.id, item.unitId)
        if (!unit.canPurchase) throw new BusinessError('invalid_unit', `${product.name} is not bought by the ${unit.name}.`, { key: 'unitNotPurchasable', values: { name: product.name, unit: unit.name } })
        if (product.trackBatches && product.trackExpiry && !item.expiryDate) {
          throw new BusinessError('expiry_required', `Enter the expiry date for "${product.name}".`, { values: { name: product.name } })
        }
        lines.push({ item, product, unit, baseQty: quantityToBase(item.quantity, unit, product) })
      }

      const totals = purchaseTotals(data.items, data.discount, data.additionalCost, data.paid)
      if (data.discount > totals.subtotal) throw new BusinessError('invalid', 'The discount is larger than the purchase amount.', { key: 'discountTooLarge' })
      if (data.paid > totals.total) throw new BusinessError('overpaid', 'Paid amount is more than the purchase total.')
      if (totals.due > 0 && !data.supplierId) throw new BusinessError('due_needs_supplier', 'Select a supplier to buy on credit (due).')

      const now = Date.now()
      const purchaseNo = formatDocNo(settings.purchasePrefix, await nextCounter(tx, 'purchase'))
      const [p] = await tx
        .insert(purchases)
        .values({
          purchaseNo,
          idempotencyKey: data.idempotencyKey,
          supplierId: data.supplierId ?? null,
          supplierName,
          referenceNo: data.referenceNo || null,
          purchaseDate: data.purchaseDate,
          status: 'completed',
          subtotal: totals.subtotal,
          discount: data.discount,
          additionalCost: data.additionalCost,
          total: totals.total,
          paid: data.paid,
          due: totals.due,
          userId: actor.id,
          userName: actor.name,
          note: data.note || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: purchases.id })

      const costChanges: Array<{ product: string; unit: string; before: number; after: number }> = []
      for (const [i, l] of lines.entries()) {
        const stocked = await stockIn(tx, actor, {
          productId: l.product.id,
          type: 'purchase',
          qty: l.baseQty,
          value: totals.landed[i],
          batch: { batchNo: l.item.batchNo, expiryDate: l.item.expiryDate, purchaseId: p.id },
          refType: 'purchase',
          refId: p.id,
          reason: purchaseNo,
        })
        await tx.insert(purchaseItems).values({
          purchaseId: p.id,
          productId: l.product.id,
          productName: l.product.name,
          sku: l.product.sku,
          unitId: l.unit.id,
          unitName: l.unit.name,
          unitFactor: l.unit.factor,
          quantity: l.item.quantity,
          baseQty: l.baseQty,
          unitCost: l.item.unitCost,
          amount: totals.amounts[i],
          lineTotal: totals.landed[i],
          batchId: stocked.batchId ?? null,
          batchNo: stocked.batchNo ?? null,
          expiryDate: l.product.trackBatches && l.product.trackExpiry ? (l.item.expiryDate ?? null) : null,
          sortOrder: i,
          createdAt: now,
        })
        // The unit's purchase price is the suggestion for the next purchase: keep the latest cost.
        if (l.item.unitCost > 0 && l.item.unitCost !== l.unit.purchasePrice) {
          await tx.update(productUnits).set({ purchasePrice: l.item.unitCost, updatedAt: now }).where(eq(productUnits.id, l.unit.id))
          costChanges.push({ product: l.product.name, unit: l.unit.name, before: l.unit.purchasePrice, after: l.item.unitCost })
          l.unit.purchasePrice = l.item.unitCost
        }
      }
      if (data.supplierId && totals.due > 0) {
        await tx
          .update(suppliers)
          .set({ balance: sql`${suppliers.balance} + ${totals.due}`, updatedAt: now })
          .where(eq(suppliers.id, data.supplierId))
      }
      await writeAudit(tx, actor, {
        action: 'purchase.create',
        module: 'purchases',
        entityId: p.id,
        after: {
          purchaseNo,
          supplier: supplierName || undefined,
          total: totals.total,
          paid: data.paid,
          due: totals.due,
          items: lines.map((l) => ({ product: l.product.name, qty: `${l.item.quantity} ${l.unit.name}`, baseQty: l.baseQty, unitCost: l.item.unitCost })),
          ...(costChanges.length && { costChanges }),
        },
      })
      return p.id
    })
    return (await getPurchase(db, id))!
  } catch (e) {
    // Two identical requests at the same moment: the loser hits the unique key and returns the winner.
    const again = await byIdempotencyKey(db, data.idempotencyKey)
    if (again) return again
    throw e
  }
}

/**
 * Cancel a purchase: take its stock back out (from the same batches, at the cost it added) and remove
 * its due from the supplier. Refused when some of that stock has already been sold or written off.
 */
export async function cancelPurchase(db: Db, actor: Actor, id: ID, input: { reason: string }): Promise<PurchaseDetail> {
  assertCan(actor, 'purchases.manage')
  const { reason } = cancelSchema.parse(input)
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update')
    if (!p) throw new BusinessError('not_found', 'Purchase not found.', { key: 'purchaseNotFound' })
    if (p.status !== 'completed') throw new BusinessError('conflict', 'Only a completed purchase without returns can be cancelled.', { key: 'cannotCancel' })
    const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id)).orderBy(asc(purchaseItems.sortOrder))
    for (const item of items) {
      try {
        await stockOut(tx, actor, {
          productId: item.productId,
          type: 'purchase_cancel',
          qty: item.baseQty,
          batchId: item.batchId ?? undefined,
          exactValue: item.lineTotal,
          allowNegative: false,
          refType: 'purchase',
          refId: id,
          reason: `${p.purchaseNo}: ${reason}`,
        })
      } catch (e) {
        if (e instanceof BusinessError && e.code === 'insufficient_stock') {
          throw new BusinessError('stock_used', `Cannot cancel: part of “${item.productName}” from this purchase was already sold or written off.`, {
            values: { name: item.productName },
          })
        }
        throw e
      }
    }
    const now = Date.now()
    if (p.supplierId && p.due > 0) {
      await tx
        .update(suppliers)
        .set({ balance: sql`${suppliers.balance} - ${p.due}`, updatedAt: now })
        .where(eq(suppliers.id, p.supplierId))
    }
    await tx.update(purchases).set({ status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now }).where(eq(purchases.id, id))
    await writeAudit(tx, actor, {
      action: 'purchase.cancel',
      module: 'purchases',
      entityId: id,
      before: { status: p.status, due: p.due },
      after: { status: 'cancelled' },
      reason,
    })
  })
  return (await getPurchase(db, id))!
}

export async function getPurchase(db: Db, id: ID): Promise<PurchaseDetail | null> {
  const [row] = await db.select().from(purchases).where(eq(purchases.id, id))
  if (!row) return null
  const items = await db
    .select({ i: purchaseItems, base: products.baseUnitName })
    .from(purchaseItems)
    .innerJoin(products, eq(products.id, purchaseItems.productId))
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(asc(purchaseItems.sortOrder))
  return { ...toSummary(row, items.length), items: items.map((r) => toLine(r.i, r.base)) }
}

export interface PurchaseFilter {
  q?: string
  status?: PurchaseSummary['status']
  supplierId?: ID
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listPurchases(db: Db, f: PurchaseFilter): Promise<Page<PurchaseSummary> & { totals: { total: number; due: number } }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25))
  const q = f.q?.trim()
  const conds: Array<SQL | undefined> = [
    f.status ? eq(purchases.status, f.status) : undefined,
    f.supplierId ? eq(purchases.supplierId, f.supplierId) : undefined,
    f.from ? gte(purchases.purchaseDate, f.from) : undefined,
    f.to ? lte(purchases.purchaseDate, f.to) : undefined,
  ]
  if (q) {
    // Match the purchase number, supplier, reference, or any product on it.
    const withProduct = db.select({ id: purchaseItems.purchaseId }).from(purchaseItems).where(ilike(purchaseItems.productName, `%${q}%`))
    conds.push(or(ilike(purchases.purchaseNo, `%${q}%`), ilike(purchases.supplierName, `%${q}%`), ilike(purchases.referenceNo, `%${q}%`), inArray(purchases.id, withProduct)))
  }
  const where = and(...conds)
  const [rows, [agg]] = await Promise.all([
    db
      .select()
      .from(purchases)
      .where(where)
      .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        n: count(),
        // Cancelled purchases don't count towards money totals.
        total: sql<string>`coalesce(sum(case when ${purchases.status} <> 'cancelled' then ${purchases.total} else 0 end), 0)`,
        due: sql<string>`coalesce(sum(case when ${purchases.status} <> 'cancelled' then ${purchases.due} else 0 end), 0)`,
      })
      .from(purchases)
      .where(where),
  ])
  const counts = rows.length
    ? await db
        .select({ id: purchaseItems.purchaseId, n: count() })
        .from(purchaseItems)
        .where(inArray(purchaseItems.purchaseId, rows.map((r) => r.id)))
        .groupBy(purchaseItems.purchaseId)
    : []
  const byId = new Map(counts.map((c) => [c.id, c.n]))
  return {
    page,
    pageSize,
    total: agg.n,
    totals: { total: Number(agg.total), due: Number(agg.due) },
    items: rows.map((r) => toSummary(r, byId.get(r.id) ?? 0)),
  }
}

/** Whether a product appears on any purchase (keeps it from being deleted). */
export async function productOnPurchases(db: Db, productId: ID): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(purchaseItems).where(eq(purchaseItems.productId, productId))
  return r.n > 0
}

