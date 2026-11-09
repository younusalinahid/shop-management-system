import { and, asc, count, desc, eq, gt, inArray, ne } from 'drizzle-orm'
import type { ID, Money, Product, ProductBarcode, ProductUnit, RecordStatus, StockMovement, StockMovementType } from '@/types/db'
import { makeInStoreEan13 } from '@/lib/barcode'
import { BusinessError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import {
  adjustPrice,
  bulkPriceSchema,
  type BulkPriceInput,
  type CatalogSnapshot,
  MAX_MONEY,
  normalizeSku,
  type PriceField,
  type ProductData,
  type ProductDetail,
  type ProductInput,
  productInputSchema,
} from '@/lib/product'
import type { Db } from '../db'
import { brands, categories, productBarcodes, productBatches, products, productUnits, stockMovements } from '../db/schema'
import { type Actor, assertCan, diffFields, writeAudit } from './audit'
import { listBrands, listCategories } from './catalog'
import { nextCounter } from './counter'

/**
 * Product catalog: products, their units (with independent prices) and barcodes.
 *
 * Stock fields (`stockQty`, `stockValue`) are NOT edited here. New products start at zero;
 * only the inventory service (Phase 3) changes stock, always together with a stock movement.
 */

// ---------------------------------------------------------------- row mapping

type ProductRow = typeof products.$inferSelect
type UnitRow = typeof productUnits.$inferSelect
type BarcodeRow = typeof productBarcodes.$inferSelect

export const toProduct = (r: ProductRow): Product => ({
  ...r,
  categoryId: r.categoryId ?? undefined,
  brandId: r.brandId ?? undefined,
  description: r.description ?? undefined,
  imageDataUrl: r.imageDataUrl ?? undefined,
})
export const toUnit = (r: UnitRow): ProductUnit => ({ ...r, symbol: r.symbol ?? undefined })
export const toBarcode = (r: BarcodeRow): ProductBarcode => ({ ...r, unitId: r.unitId ?? undefined })

// ---------------------------------------------------------------- helpers

async function assertSkuFree(db: Db, sku: string, exceptId?: ID) {
  const [clash] = await db
    .select({ name: products.name })
    .from(products)
    .where(exceptId ? and(eq(products.sku, sku), ne(products.id, exceptId)) : eq(products.sku, sku))
  if (clash) throw new BusinessError('duplicate_sku', `SKU ${sku} is already used by "${clash.name}".`)
}

async function generateSku(db: Db): Promise<string> {
  for (;;) {
    const sku = `P${String(await nextCounter(db, 'product')).padStart(5, '0')}`
    const [used] = await db.select({ id: products.id }).from(products).where(eq(products.sku, sku))
    if (!used) return sku
  }
}

async function assertBarcodesFree(db: Db, codes: string[], productId: ID | null) {
  if (codes.length === 0) return
  const clashes = await db
    .select({ code: productBarcodes.code, owner: products.name, productId: productBarcodes.productId })
    .from(productBarcodes)
    .innerJoin(products, eq(products.id, productBarcodes.productId))
    .where(inArray(productBarcodes.code, codes))
  const foreign = clashes.find((b) => b.productId !== productId)
  if (foreign) throw new BusinessError('duplicate_barcode', `Barcode ${foreign.code} already belongs to "${foreign.owner}".`)
}

async function assertRefs(db: Db, data: ProductData) {
  if (data.categoryId) {
    const [c] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, data.categoryId))
    if (!c) throw new BusinessError('not_found', 'The selected category no longer exists.')
  }
  if (data.brandId) {
    const [b] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, data.brandId))
    if (!b) throw new BusinessError('not_found', 'The selected brand no longer exists.')
  }
}

function buildUnits(productId: ID, data: ProductData, now: number, existing: Map<ID, ProductUnit>): ProductUnit[] {
  // Base unit first, then by factor, so pickers list Piece, Packet, Carton in order.
  const ordered = [...data.units].sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.factor - b.factor)
  return ordered.map((u, i) => ({
    id: u.id,
    productId,
    name: u.name,
    symbol: u.symbol || undefined,
    factor: u.factor,
    isBase: u.isBase,
    canPurchase: u.canPurchase,
    canSell: u.canSell,
    retailPrice: u.retailPrice,
    wholesalePrice: u.wholesalePrice,
    purchasePrice: u.purchasePrice,
    sortOrder: i,
    createdAt: existing.get(u.id)?.createdAt ?? now,
    updatedAt: now,
  }))
}

const unitValues = (u: ProductUnit) => ({ ...u, symbol: u.symbol ?? null })

/** Product fields worth recording in the audit log (no image bytes, no cached stock). */
function auditView(p: Product) {
  const { imageDataUrl, stockQty: _q, stockValue: _v, createdAt: _c, updatedAt: _u, ...rest } = p
  return { ...rest, image: imageDataUrl ? '[image]' : undefined }
}

function unitAuditView(u: ProductUnit) {
  return { name: u.name, factor: u.factor, isBase: u.isBase, retail: u.retailPrice, wholesale: u.wholesalePrice, purchase: u.purchasePrice }
}

const PRICE_FIELDS: PriceField[] = ['retailPrice', 'wholesalePrice', 'purchasePrice']

interface PriceChange {
  unit: string
  field: PriceField
  before: Money
  after: Money
}

function priceChanges(before: ProductUnit[], after: ProductUnit[]): PriceChange[] {
  const old = new Map(before.map((u) => [u.id, u]))
  const changes: PriceChange[] = []
  for (const u of after) {
    const prev = old.get(u.id)
    for (const field of PRICE_FIELDS) {
      const was = prev ? prev[field] : 0
      if (was !== u[field] && (prev || u[field] !== 0)) changes.push({ unit: u.name, field, before: was, after: u[field] })
    }
  }
  return changes
}

async function unitsOf(db: Db, productId: ID): Promise<ProductUnit[]> {
  return (await db.select().from(productUnits).where(eq(productUnits.productId, productId)).orderBy(asc(productUnits.sortOrder))).map(toUnit)
}

/**
 * Whether the product has stock or any recorded history. Sale, purchase and return lines join
 * this check when those tables arrive in later phases.
 */
export async function productHasHistory(db: Db, productId: ID): Promise<boolean> {
  const [p] = await db.select({ stockQty: products.stockQty, stockValue: products.stockValue }).from(products).where(eq(products.id, productId))
  if (!p) return false
  if (p.stockQty !== 0 || p.stockValue !== 0) return true
  const [[m], [b]] = await Promise.all([
    db.select({ n: count() }).from(stockMovements).where(eq(stockMovements.productId, productId)),
    db.select({ n: count() }).from(productBatches).where(eq(productBatches.productId, productId)),
  ])
  return m.n > 0 || b.n > 0
}

// ---------------------------------------------------------------- commands

export async function createProduct(db: Db, actor: Actor, input: ProductInput): Promise<Product> {
  assertCan(actor, 'products.edit')
  const data = productInputSchema.parse(input)
  if (data.units.some((u) => u.retailPrice || u.wholesalePrice || u.purchasePrice)) assertCan(actor, 'products.edit_price')
  return db.transaction(async (tx) => insertProduct(tx, actor, data))
}

/**
 * Insert a validated product. Run it inside a transaction (createProduct, and the CSV import,
 * which inserts many products atomically).
 */
export async function insertProduct(db: Db, actor: Actor, data: ProductData): Promise<Product> {
  const now = Date.now()
  await assertRefs(db, data)
  const sku = data.sku ? normalizeSku(data.sku) : await generateSku(db)
  await assertSkuFree(db, sku)
  await assertBarcodesFree(db, data.barcodes.map((b) => b.code), null)
  const [clashUnit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(inArray(productUnits.id, data.units.map((u) => u.id)))
  if (clashUnit) throw new BusinessError('invalid_unit', 'Unit ids must be new for a new product.')

  const [row] = await db
    .insert(products)
    .values({
      name: data.name,
      sku,
      categoryId: data.categoryId ?? null,
      brandId: data.brandId ?? null,
      description: data.description || null,
      imageDataUrl: data.imageDataUrl ?? null,
      baseUnitName: data.units.find((u) => u.isBase)!.name,
      allowFraction: data.allowFraction,
      stockQty: 0,
      stockValue: 0,
      minStockQty: data.minStockQty,
      taxRate: data.taxRate,
      trackBatches: data.trackBatches,
      trackExpiry: data.trackExpiry,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  const product = toProduct(row)
  const units = buildUnits(product.id, data, now, new Map())
  await db.insert(productUnits).values(units.map(unitValues))
  if (data.barcodes.length) {
    await db.insert(productBarcodes).values(data.barcodes.map((b) => ({ code: b.code, productId: product.id, unitId: b.unitId ?? null, createdAt: now })))
  }
  await writeAudit(db, actor, {
    action: 'product.create',
    module: 'products',
    entityId: product.id,
    after: { ...auditView(product), units: units.map(unitAuditView), barcodes: data.barcodes.map((b) => b.code) },
  })
  return product
}

export async function updateProduct(db: Db, actor: Actor, id: ID, input: ProductInput): Promise<Product> {
  assertCan(actor, 'products.edit')
  const data = productInputSchema.parse(input)
  const now = Date.now()

  return db.transaction(async (tx) => {
    // Lock the product row so two simultaneous edits can't interleave.
    const [currentRow] = await tx.select().from(products).where(eq(products.id, id)).for('update')
    if (!currentRow) throw new BusinessError('not_found', 'Product not found.')
    const current = toProduct(currentRow)
    const currentUnits = await unitsOf(tx, id)
    if (!can(actor.role, 'products.view_cost')) {
      // This role was sent 0 for purchase prices; keep the stored ones instead of overwriting them.
      const stored = new Map(currentUnits.map((u) => [u.id, u.purchasePrice]))
      data.units = data.units.map((u) => ({ ...u, purchasePrice: stored.get(u.id) ?? 0 }))
    }
    const prices = priceChanges(currentUnits, buildUnits(id, data, 0, new Map()))
    if (prices.length) assertCan(actor, 'products.edit_price')

    await assertRefs(tx, data)
    const sku = data.sku ? normalizeSku(data.sku) : current.sku
    await assertSkuFree(tx, sku, id)
    await assertBarcodesFree(tx, data.barcodes.map((b) => b.code), id)

    const foreignUnit = (
      await tx
        .select({ productId: productUnits.productId })
        .from(productUnits)
        .where(inArray(productUnits.id, data.units.map((u) => u.id)))
    ).find((u) => u.productId !== id)
    if (foreignUnit) throw new BusinessError('invalid_unit', 'A unit in the list belongs to another product.')

    const oldBase = currentUnits.find((u) => u.isBase)
    const newBase = data.units.find((u) => u.isBase)!
    if (oldBase && oldBase.id !== newBase.id && (await productHasHistory(tx, id))) {
      throw new BusinessError(
        'base_unit_locked',
        `The base unit cannot be replaced because this product already has stock or history (stock is counted in ${oldBase.name}). You can still rename it or add other units.`,
      )
    }
    if (current.trackBatches && !data.trackBatches) {
      const [open] = await tx
        .select({ n: count() })
        .from(productBatches)
        .where(and(eq(productBatches.productId, id), gt(productBatches.qtyRemaining, 0)))
      if (open.n > 0) throw new BusinessError('batches_open', 'Batch tracking cannot be turned off while batches still hold stock.')
    }

    const units = buildUnits(id, data, now, new Map(currentUnits.map((u) => [u.id, u])))
    const patch = {
      name: data.name,
      sku,
      categoryId: data.categoryId,
      brandId: data.brandId,
      description: data.description || undefined,
      imageDataUrl: data.imageDataUrl,
      baseUnitName: units[0].name,
      allowFraction: data.allowFraction,
      minStockQty: data.minStockQty,
      taxRate: data.taxRate,
      trackBatches: data.trackBatches,
      trackExpiry: data.trackExpiry,
    }
    const next: Product = { ...current, ...patch, updatedAt: now }
    await tx
      .update(products)
      .set({ ...patch, categoryId: patch.categoryId ?? null, brandId: patch.brandId ?? null, description: patch.description ?? null, imageDataUrl: patch.imageDataUrl ?? null, updatedAt: now })
      .where(eq(products.id, id))

    // Units: barcodes pointing at removed units go first, then remove/upsert units.
    // Unique (product, lower(name)) and "one base" indexes are checked per statement, so clear the
    // product's units and re-insert them; ids are kept, so barcode links survive.
    const oldBarcodes = (await tx.select().from(productBarcodes).where(eq(productBarcodes.productId, id))).map(toBarcode)
    await tx.delete(productBarcodes).where(eq(productBarcodes.productId, id))
    await tx.delete(productUnits).where(eq(productUnits.productId, id))
    await tx.insert(productUnits).values(units.map(unitValues))
    const keep = new Map(oldBarcodes.map((b) => [b.code, b]))
    if (data.barcodes.length) {
      await tx.insert(productBarcodes).values(
        data.barcodes.map((b) => ({
          id: keep.get(b.code)?.id,
          code: b.code,
          productId: id,
          unitId: b.unitId ?? null,
          createdAt: keep.get(b.code)?.createdAt ?? now,
        })),
      )
    }

    const diff = diffFields(auditView(current), auditView(next))
    const unitsBefore = currentUnits.map(unitAuditView)
    const unitsAfter = units.map(unitAuditView)
    const unitsChanged = JSON.stringify(unitsBefore) !== JSON.stringify(unitsAfter)
    const codesBefore = oldBarcodes.map((b) => b.code).sort()
    const codesAfter = data.barcodes.map((b) => b.code).sort()
    const codesChanged = JSON.stringify(codesBefore) !== JSON.stringify(codesAfter)
    if (diff.changed || unitsChanged || codesChanged) {
      await writeAudit(tx, actor, {
        action: 'product.update',
        module: 'products',
        entityId: id,
        before: { ...diff.before, ...(unitsChanged && { units: unitsBefore }), ...(codesChanged && { barcodes: codesBefore }) },
        after: { ...diff.after, ...(unitsChanged && { units: unitsAfter }), ...(codesChanged && { barcodes: codesAfter }) },
      })
    }
    if (prices.length) await writeAudit(tx, actor, { action: 'product.price_change', module: 'products', entityId: id, after: prices })
    return next
  })
}

export async function setProductStatus(db: Db, actor: Actor, id: ID, status: RecordStatus, reason?: string): Promise<void> {
  assertCan(actor, 'products.edit')
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ status: products.status }).from(products).where(eq(products.id, id))
    if (!current) throw new BusinessError('not_found', 'Product not found.')
    if (current.status === status) return
    await tx.update(products).set({ status, updatedAt: Date.now() }).where(eq(products.id, id))
    await writeAudit(tx, actor, {
      action: status === 'archived' ? 'product.archive' : 'product.restore',
      module: 'products',
      entityId: id,
      before: { status: current.status },
      after: { status },
      reason,
    })
  })
}

/**
 * Permanently delete a product that was never used. Anything with stock or history must be
 * archived instead, so invoices, purchases and reports stay intact.
 */
export async function deleteProduct(db: Db, actor: Actor, id: ID): Promise<void> {
  assertCan(actor, 'products.edit')
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(products).where(eq(products.id, id)).for('update')
    if (!row) throw new BusinessError('not_found', 'Product not found.')
    if (await productHasHistory(tx, id)) {
      throw new BusinessError('has_history', 'This product has stock or transaction history, so it cannot be deleted. Archive it instead.')
    }
    const units = await unitsOf(tx, id)
    const codes = await tx.select({ code: productBarcodes.code }).from(productBarcodes).where(eq(productBarcodes.productId, id))
    // Units and barcodes are removed by ON DELETE CASCADE.
    await tx.delete(products).where(eq(products.id, id))
    await writeAudit(tx, actor, {
      action: 'product.delete',
      module: 'products',
      entityId: id,
      before: { ...auditView(toProduct(row)), units: units.map(unitAuditView), barcodes: codes.map((b) => b.code) },
    })
  })
}

// ---------------------------------------------------------------- bulk price update

/** Apply one price rule to many products atomically. Returns the number of unit prices changed. */
export async function bulkUpdatePrices(db: Db, actor: Actor, input: BulkPriceInput): Promise<number> {
  assertCan(actor, 'products.edit', 'products.edit_price')
  const data = bulkPriceSchema.parse(input)
  if (data.method === 'percent' && data.value <= -10000) throw new BusinessError('invalid', 'A decrease must be less than 100%.')
  const now = Date.now()

  return db.transaction(async (tx) => {
    let changed = 0
    const rows = await tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, data.productIds))
    for (const product of rows) {
      const units = await unitsOf(tx, product.id)
      const changes: PriceChange[] = []
      for (const u of units) {
        if (data.scope === 'base' && !u.isBase) continue
        const before = u[data.field]
        if (before === 0 && data.method === 'percent') continue
        const after = adjustPrice(before, data.method, data.value, data.roundTo)
        if (after < 0) throw new BusinessError('negative_price', `"${product.name}" (${u.name}) would get a negative price.`)
        if (after > MAX_MONEY) throw new BusinessError('invalid', `"${product.name}" (${u.name}) would get a price that is too large.`)
        if (after === before) continue
        await tx
          .update(productUnits)
          .set({ [data.field]: after, updatedAt: now })
          .where(eq(productUnits.id, u.id))
        changes.push({ unit: u.name, field: data.field, before, after })
      }
      if (changes.length) {
        changed += changes.length
        await tx.update(products).set({ updatedAt: now }).where(eq(products.id, product.id))
        await writeAudit(tx, actor, {
          action: 'product.price_change',
          module: 'products',
          entityId: product.id,
          after: changes,
          reason: data.reason || 'Bulk price update',
        })
      }
    }
    return changed
  })
}

// ---------------------------------------------------------------- barcodes

async function nextFreeEan13(db: Db, exclude: readonly string[]): Promise<string> {
  for (;;) {
    const code = makeInStoreEan13(await nextCounter(db, 'barcode'))
    if (exclude.includes(code)) continue
    const [used] = await db.select({ id: productBarcodes.id }).from(productBarcodes).where(eq(productBarcodes.code, code))
    if (!used) return code
  }
}

/**
 * Next unused in-store EAN-13 code ("2…", reserved for internal use).
 * `exclude` covers codes typed into an unsaved form.
 */
export async function generateBarcode(db: Db, actor: Actor, exclude: readonly string[] = []): Promise<string> {
  assertCan(actor, 'products.edit')
  return nextFreeEan13(db, exclude)
}

/** Give each listed product that has no barcode yet one generated in-store code (base unit). */
export async function assignGeneratedBarcodes(db: Db, actor: Actor, productIds: readonly ID[]): Promise<number> {
  assertCan(actor, 'products.edit')
  return db.transaction(async (tx) => {
    let added = 0
    for (const productId of productIds) {
      const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId))
      if (!p) continue
      const [has] = await tx.select({ n: count() }).from(productBarcodes).where(eq(productBarcodes.productId, productId))
      if (has.n > 0) continue
      const code = await nextFreeEan13(tx, [])
      await tx.insert(productBarcodes).values({ code, productId, createdAt: Date.now() })
      await writeAudit(tx, actor, { action: 'product.barcode_generate', module: 'products', entityId: productId, after: { barcode: code } })
      added++
    }
    return added
  })
}

/** Resolve a scanned / typed barcode to its product and (optionally) package unit. */
export async function findByBarcode(db: Db, code: string): Promise<{ product: Product; unit?: ProductUnit } | null> {
  const [hit] = await db
    .select({ product: products, unit: productUnits })
    .from(productBarcodes)
    .innerJoin(products, eq(products.id, productBarcodes.productId))
    .leftJoin(productUnits, eq(productUnits.id, productBarcodes.unitId))
    .where(eq(productBarcodes.code, code.trim()))
  if (!hit) return null
  return { product: toProduct(hit.product), unit: hit.unit ? toUnit(hit.unit) : undefined }
}

// ---------------------------------------------------------------- queries

export async function getProductDetail(db: Db, id: ID): Promise<ProductDetail | null> {
  const [row] = await db.select().from(products).where(eq(products.id, id))
  if (!row) return null
  const product = toProduct(row)
  const [units, barcodeRows, category, brand, hasHistory, movementRows] = await Promise.all([
    unitsOf(db, id),
    db.select().from(productBarcodes).where(eq(productBarcodes.productId, id)),
    product.categoryId ? db.select().from(categories).where(eq(categories.id, product.categoryId)) : Promise.resolve([]),
    product.brandId ? db.select().from(brands).where(eq(brands.id, product.brandId)) : Promise.resolve([]),
    productHasHistory(db, id),
    db.select().from(stockMovements).where(eq(stockMovements.productId, id)).orderBy(desc(stockMovements.createdAt)).limit(20),
  ])
  return {
    product,
    units,
    barcodes: barcodeRows.map(toBarcode),
    category: category[0] ? { ...category[0], parentId: category[0].parentId ?? undefined, description: category[0].description ?? undefined } : undefined,
    brand: brand[0] ? { ...brand[0], description: brand[0].description ?? undefined } : undefined,
    hasHistory,
    recentMovements: movementRows.map(
      (m): StockMovement => ({
        ...m,
        type: m.type as StockMovementType,
        batchId: m.batchId ?? undefined,
        refType: m.refType ?? undefined,
        refId: m.refId ?? undefined,
        reason: m.reason ?? undefined,
      }),
    ),
  }
}

/** The whole catalog for list pages and pickers. */
export async function getCatalog(db: Db, opts: { includeCost: boolean }): Promise<CatalogSnapshot> {
  const [productRows, unitRows, barcodeRows, categoryList, brandList] = await Promise.all([
    db.select().from(products).orderBy(asc(products.name)),
    db.select().from(productUnits).orderBy(asc(productUnits.sortOrder)),
    db.select().from(productBarcodes),
    listCategories(db),
    listBrands(db),
  ])
  return {
    products: productRows.map((r) => {
      const p = toProduct(r)
      // Stock value reveals cost; hide it from roles that can't see purchase prices.
      return opts.includeCost ? p : { ...p, stockValue: 0 }
    }),
    units: unitRows.map((u) => (opts.includeCost ? toUnit(u) : { ...toUnit(u), purchasePrice: 0 })),
    barcodes: barcodeRows.map(toBarcode),
    categories: categoryList,
    brands: brandList,
  }
}

/** A product detail with cost fields removed for roles without products.view_cost. */
export function hideCost(d: ProductDetail): ProductDetail {
  return {
    ...d,
    product: { ...d.product, stockValue: 0 },
    units: d.units.map((u) => ({ ...u, purchasePrice: 0 })),
    recentMovements: d.recentMovements.map((m) => ({ ...m, valueChange: 0 })),
  }
}
