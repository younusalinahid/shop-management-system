import { and, asc, count, desc, eq, gt, gte, ilike, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { BaseQty, DateOnly, ID, Money, Product, ProductBatch, ProductUnit, StockMovementType } from '@/types/db'
import { addDays, NO_EXPIRY, startOfDateOnly, todayDateOnly } from '@/lib/datetime'
import { divRound } from '@/lib/decimal'
import { BusinessError } from '@/lib/errors'
import { adjustmentSchema, type AdjustmentInput, type BatchRow, isIncrease, type MovementRow, type Page } from '@/lib/inventory'
import { allocate, multiplyMoney } from '@/lib/money'
import { toBaseQty, UnitError } from '@/lib/units'
import type { Db } from '../db'
import { productBatches, products, productUnits, stockMovements, users } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { formatDocNo, nextCounter } from './counter'
import { toProduct, toUnit } from './product'

/**
 * InventoryService: the ONLY code that changes stock.
 *
 * - Stock (`products.stock_qty`) is an integer in base units; every change writes a stock_movements row
 *   in the same transaction, so the movement history always adds up to the stock.
 * - Valuation is weighted-average cost: `products.stock_value` holds the total cost of what is on hand.
 *   Stock out removes value at the average cost (stockValue × qty / stockQty, rounded to the poisha).
 * - Batch-tracked products keep stock per batch. Stock out takes from the batch that expires first
 *   (FEFO). Stock received before batch tracking was turned on is "loose" stock and is used last.
 *
 * Callers pass their transaction (`tx`), so a purchase or sale and its stock change commit together.
 */

type BatchDbRow = typeof productBatches.$inferSelect
const toBatch = (r: BatchDbRow): ProductBatch => ({ ...r, purchaseId: r.purchaseId ?? undefined })

/** Lock a product row for the rest of the transaction; concurrent stock changes wait their turn. */
export async function lockProduct(tx: Db, productId: ID): Promise<Product> {
  const [row] = await tx.select().from(products).where(eq(products.id, productId)).for('update')
  if (!row) throw new BusinessError('not_found', 'Product not found.', { key: 'productNotFound' })
  return toProduct(row)
}

export interface StockInInput {
  productId: ID
  type: StockMovementType
  /** Base units, > 0. */
  qty: BaseQty
  /** Total cost (poisha) of the quantity coming in. */
  value: Money
  /** Used when the product tracks batches. */
  batch?: { batchNo?: string; expiryDate?: DateOnly; purchaseId?: ID }
  refType?: string
  refId?: string
  reason?: string
}

export async function stockIn(tx: Db, actor: Actor, input: StockInInput): Promise<{ batchId?: ID; batchNo?: string; product: Product }> {
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new BusinessError('invalid_quantity', 'Quantity must be greater than zero.', { key: 'qtyPositive' })
  const p = await lockProduct(tx, input.productId)
  const now = Date.now()

  let batchId: ID | undefined
  let batchNo: string | undefined
  if (p.trackBatches) {
    const expiryDate = p.trackExpiry ? input.batch?.expiryDate : NO_EXPIRY
    if (!expiryDate) throw new BusinessError('expiry_required', `Enter the expiry date for "${p.name}".`, { values: { name: p.name } })
    batchNo = input.batch?.batchNo?.trim() || formatDocNo('B', await nextCounter(tx, 'batch'), 5)
    const [b] = await tx
      .insert(productBatches)
      .values({
        productId: p.id,
        batchNo,
        purchaseId: input.batch?.purchaseId ?? null,
        receivedAt: now,
        expiryDate,
        qtyReceived: input.qty,
        qtyRemaining: input.qty,
        costTotal: input.value,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: productBatches.id })
    batchId = b.id
  }

  const qtyAfter = p.stockQty + input.qty
  // Value is meaningless while stock is at or below zero (negative stock from oversold sales).
  const valueAfter = qtyAfter <= 0 ? 0 : Math.max(0, p.stockValue) + input.value
  await tx.update(products).set({ stockQty: qtyAfter, stockValue: valueAfter, updatedAt: now }).where(eq(products.id, p.id))
  await tx.insert(stockMovements).values({
    productId: p.id,
    batchId: batchId ?? null,
    type: input.type,
    qtyChange: input.qty,
    valueChange: valueAfter - p.stockValue,
    balanceAfter: qtyAfter,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    reason: input.reason || null,
    userId: actor.id,
    createdAt: now,
  })
  return { batchId, batchNo, product: { ...p, stockQty: qtyAfter, stockValue: valueAfter } }
}

export interface StockOutInput {
  productId: ID
  type: StockMovementType
  qty: BaseQty
  /** Take only from this batch (write-off of one batch, cancelling the purchase that created it). */
  batchId?: ID
  /** Remove exactly this value instead of the average cost (reversing a purchase), capped at the stock value. */
  exactValue?: Money
  allowNegative: boolean
  /** Skip expired batches in FEFO order (sales). */
  skipExpired?: boolean
  refType?: string
  refId?: string
  reason?: string
}

export interface StockOutResult {
  value: Money
  allocations: Array<{ batchId?: ID; qty: BaseQty; value: Money }>
}

export async function stockOut(tx: Db, actor: Actor, input: StockOutInput): Promise<StockOutResult> {
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new BusinessError('invalid_quantity', 'Quantity must be greater than zero.', { key: 'qtyPositive' })
  const p = await lockProduct(tx, input.productId)
  const now = Date.now()

  // 1. Decide where the quantity comes from.
  const takes: Array<{ batch?: ProductBatch; qty: BaseQty }> = []
  let left = input.qty
  const short = (available: BaseQty) =>
    new BusinessError('insufficient_stock', `Not enough stock of "${p.name}". Available: ${available} ${p.baseUnitName}.`, {
      values: { name: p.name, available: available.toLocaleString('en-IN'), unit: p.baseUnitName },
    })

  if (p.trackBatches || input.batchId) {
    const batches = (
      await tx
        .select()
        .from(productBatches)
        .where(and(eq(productBatches.productId, p.id), gt(productBatches.qtyRemaining, 0), input.batchId ? eq(productBatches.id, input.batchId) : undefined))
        .orderBy(asc(productBatches.expiryDate), asc(productBatches.receivedAt))
        .for('update')
    ).map(toBatch)
    if (input.batchId && batches.length === 0) throw short(0)
    const today = todayDateOnly()
    const usable = input.skipExpired ? batches.filter((b) => b.expiryDate >= today) : batches
    for (const b of usable) {
      if (left === 0) break
      const q = Math.min(left, b.qtyRemaining)
      takes.push({ batch: b, qty: q })
      left -= q
    }
    if (input.batchId && left > 0) throw short(batches[0].qtyRemaining)
    if (left > 0) {
      // Loose stock: what the product holds beyond its batches (stock from before batch tracking).
      const inBatches = batches.reduce((s, b) => s + b.qtyRemaining, 0)
      const loose = Math.max(0, p.stockQty - inBatches)
      const q = input.allowNegative ? left : Math.min(left, loose)
      if (q > 0) takes.push({ qty: q })
      left -= q
      if (left > 0) throw short(usable.reduce((s, b) => s + b.qtyRemaining, 0) + loose)
    }
  } else {
    if (!input.allowNegative && p.stockQty < input.qty) throw short(Math.max(0, p.stockQty))
    takes.push({ qty: input.qty })
  }

  // 2. Value leaving stock.
  const qtyAfter = p.stockQty - input.qty
  const onHand = Math.max(0, p.stockQty)
  let valueOut =
    input.exactValue !== undefined
      ? Math.min(input.exactValue, p.stockValue)
      : onHand === 0
        ? 0
        : divRound(BigInt(p.stockValue) * BigInt(Math.min(input.qty, onHand)), BigInt(onHand))
  if (qtyAfter <= 0) valueOut = p.stockValue
  const valueAfter = p.stockValue - valueOut

  // 3. Write batches, product and one movement per source.
  const values = allocate(valueOut, takes.map((t) => t.qty))
  let balance = p.stockQty
  const allocations: StockOutResult['allocations'] = []
  for (const [i, t] of takes.entries()) {
    if (t.batch) {
      const remaining = t.batch.qtyRemaining - t.qty
      await tx
        .update(productBatches)
        .set({ qtyRemaining: remaining, status: remaining === 0 ? 'depleted' : 'active', updatedAt: now })
        .where(eq(productBatches.id, t.batch.id))
    }
    balance -= t.qty
    await tx.insert(stockMovements).values({
      productId: p.id,
      batchId: t.batch?.id ?? null,
      type: input.type,
      qtyChange: -t.qty,
      valueChange: -values[i],
      balanceAfter: balance,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reason: input.reason || null,
      userId: actor.id,
      createdAt: now,
    })
    allocations.push({ batchId: t.batch?.id, qty: t.qty, value: values[i] })
  }
  await tx.update(products).set({ stockQty: qtyAfter, stockValue: valueAfter, updatedAt: now }).where(eq(products.id, p.id))
  return { value: valueOut, allocations }
}

/**
 * Put stock back exactly where an earlier stock out took it from (same batches, same cost), e.g. when a
 * sale is cancelled. `allocations` is what stockOut returned.
 */
export async function restock(
  tx: Db,
  actor: Actor,
  input: { productId: ID; type: StockMovementType; allocations: StockOutResult['allocations']; refType?: string; refId?: string; reason?: string },
): Promise<void> {
  const p = await lockProduct(tx, input.productId)
  const now = Date.now()
  let qty = p.stockQty
  let value = p.stockValue
  for (const a of input.allocations) {
    if (a.qty <= 0) continue
    if (a.batchId) {
      await tx
        .update(productBatches)
        .set({ qtyRemaining: sql`${productBatches.qtyRemaining} + ${a.qty}`, status: 'active', updatedAt: now })
        .where(eq(productBatches.id, a.batchId))
    }
    const qtyAfter = qty + a.qty
    const valueAfter = qtyAfter <= 0 ? 0 : Math.max(0, value) + a.value
    await tx.insert(stockMovements).values({
      productId: p.id,
      batchId: a.batchId ?? null,
      type: input.type,
      qtyChange: a.qty,
      valueChange: valueAfter - value,
      balanceAfter: qtyAfter,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reason: input.reason || null,
      userId: actor.id,
      createdAt: now,
    })
    qty = qtyAfter
    value = valueAfter
  }
  await tx.update(products).set({ stockQty: qty, stockValue: value, updatedAt: now }).where(eq(products.id, p.id))
}

/** Convert a typed quantity in one of the product's units to base units, as a translated BusinessError on failure. */
export function quantityToBase(quantity: string, unit: ProductUnit, product: Product): BaseQty {
  try {
    return toBaseQty(quantity, unit, product.allowFraction)
  } catch (e) {
    if (e instanceof UnitError) {
      throw new BusinessError('invalid_quantity', `${product.name}: ${e.message}`, { key: 'badQuantity', values: { name: product.name, qty: quantity, unit: unit.name } })
    }
    throw e
  }
}

export async function unitOfProduct(db: Db, productId: ID, unitId: ID): Promise<ProductUnit> {
  const [u] = await db
    .select()
    .from(productUnits)
    .where(and(eq(productUnits.id, unitId), eq(productUnits.productId, productId)))
  if (!u) throw new BusinessError('invalid_unit', 'The selected unit does not belong to this product.', { key: 'unitNotOfProduct' })
  return toUnit(u)
}

// ---------------------------------------------------------------- manual adjustments

/** Opening stock, corrections and write-offs (damaged, lost, expired). Always with a movement and an audit record. */
export async function adjustStock(db: Db, actor: Actor, input: AdjustmentInput): Promise<Product> {
  assertCan(actor, 'inventory.adjust')
  const data = adjustmentSchema.parse(input)
  return db.transaction(async (tx) => {
    const product = await lockProduct(tx, data.productId)
    if (product.status !== 'active') throw new BusinessError('archived', 'This product is archived. Restore it first.', { key: 'productArchived' })
    const unit = await unitOfProduct(tx, product.id, data.unitId)
    const qty = quantityToBase(data.quantity, unit, product)
    const reason = data.reason || undefined
    const ref = { refType: 'adjustment', reason }

    if (isIncrease(data.type)) {
      const value = multiplyMoney(data.unitCost ?? unit.purchasePrice, data.quantity)
      const res = await stockIn(tx, actor, {
        productId: product.id,
        type: data.type,
        qty,
        value,
        batch: { batchNo: data.batchNo, expiryDate: data.expiryDate },
        ...ref,
      })
      await writeAudit(tx, actor, {
        action: 'stock.adjust',
        module: 'inventory',
        entityId: product.id,
        before: { stockQty: product.stockQty },
        after: { type: data.type, qty, value, stockQty: res.product.stockQty, batchNo: res.batchNo },
        reason,
      })
      return res.product
    }

    const out = await stockOut(tx, actor, { productId: product.id, type: data.type, qty, batchId: data.batchId, allowNegative: false, ...ref })
    await writeAudit(tx, actor, {
      action: 'stock.adjust',
      module: 'inventory',
      entityId: product.id,
      before: { stockQty: product.stockQty },
      after: { type: data.type, qty: -qty, value: -out.value, stockQty: product.stockQty - qty },
      reason,
    })
    return { ...product, stockQty: product.stockQty - qty, stockValue: product.stockValue - out.value }
  })
}

// ---------------------------------------------------------------- queries

export interface MovementFilter {
  productId?: ID
  type?: StockMovementType
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listMovements(db: Db, f: MovementFilter): Promise<Page<MovementRow>> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50))
  const where = and(
    f.productId ? eq(stockMovements.productId, f.productId) : undefined,
    f.type ? eq(stockMovements.type, f.type) : undefined,
    f.from ? gte(stockMovements.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(stockMovements.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({ m: stockMovements, productName: products.name, baseUnitName: products.baseUnitName, batchNo: productBatches.batchNo, userName: users.name })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .leftJoin(productBatches, eq(productBatches.id, stockMovements.batchId))
      .leftJoin(users, sql`${users.id}::text = ${stockMovements.userId}`)
      .where(where)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(stockMovements).where(where),
  ])
  return {
    page,
    pageSize,
    total: total.n,
    items: rows.map((r) => ({
      id: r.m.id,
      productId: r.m.productId,
      productName: r.productName,
      baseUnitName: r.baseUnitName,
      batchNo: r.batchNo ?? undefined,
      type: r.m.type as StockMovementType,
      qtyChange: r.m.qtyChange,
      valueChange: r.m.valueChange,
      balanceAfter: r.m.balanceAfter,
      refType: r.m.refType ?? undefined,
      refId: r.m.refId ?? undefined,
      reason: r.m.reason ?? undefined,
      userName: r.userName ?? (r.m.userId === 'system' ? 'System' : '—'),
      createdAt: r.m.createdAt,
    })),
  }
}

export type BatchState = 'in_stock' | 'expired' | 'expiring' | 'all'

export async function listBatches(db: Db, f: { state: BatchState; productId?: ID; q?: string; warningDays: number; today?: DateOnly }): Promise<BatchRow[]> {
  const today = f.today ?? todayDateOnly()
  const conds: Array<SQL | undefined> = [f.productId ? eq(productBatches.productId, f.productId) : undefined]
  if (f.state !== 'all') conds.push(gt(productBatches.qtyRemaining, 0))
  if (f.state === 'expired') conds.push(lt(productBatches.expiryDate, today))
  if (f.state === 'expiring') conds.push(gte(productBatches.expiryDate, today), lte(productBatches.expiryDate, addDays(today, f.warningDays)))
  const q = f.q?.trim()
  if (q) conds.push(or(ilike(products.name, `%${q}%`), ilike(productBatches.batchNo, `%${q}%`), ilike(products.sku, `%${q}%`)))
  const rows = await db
    .select({ b: productBatches, productName: products.name, sku: products.sku, baseUnitName: products.baseUnitName })
    .from(productBatches)
    .innerJoin(products, eq(products.id, productBatches.productId))
    .where(and(...conds))
    .orderBy(asc(productBatches.expiryDate), asc(products.name))
    .limit(1000)
  return rows.map((r) => ({
    ...toBatch(r.b),
    productName: r.productName,
    sku: r.sku,
    baseUnitName: r.baseUnitName,
    remainingValue: r.b.qtyReceived === 0 ? 0 : divRound(BigInt(r.b.costTotal) * BigInt(r.b.qtyRemaining), BigInt(r.b.qtyReceived)),
  }))
}

/** Batches of one product that still hold stock, FEFO order (for write-off pickers). */
export async function openBatches(db: Db, productId: ID): Promise<ProductBatch[]> {
  return (
    await db
      .select()
      .from(productBatches)
      .where(and(eq(productBatches.productId, productId), gt(productBatches.qtyRemaining, 0)))
      .orderBy(asc(productBatches.expiryDate), asc(productBatches.receivedAt))
  ).map(toBatch)
}

/** Counts for the dashboard: expired and soon-to-expire batches that still hold stock. */
export async function expiryCounts(db: Db, warningDays: number): Promise<{ expired: number; expiring: number }> {
  const today = todayDateOnly()
  const [[expired], [expiring]] = await Promise.all([
    db
      .select({ n: count() })
      .from(productBatches)
      .where(and(gt(productBatches.qtyRemaining, 0), lt(productBatches.expiryDate, today))),
    db
      .select({ n: count() })
      .from(productBatches)
      .where(and(gt(productBatches.qtyRemaining, 0), gte(productBatches.expiryDate, today), lte(productBatches.expiryDate, addDays(today, warningDays)))),
  ])
  return { expired: expired.n, expiring: expiring.n }
}
