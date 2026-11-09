import { z } from 'zod'
import { db } from '@/db/database'
import type { Brand, Category, ID, Money, Product, ProductBarcode, ProductUnit, RecordStatus } from '@/types/db'
import { makeInStoreEan13 } from '@/lib/barcode'
import { divRound } from '@/lib/decimal'
import { newId } from '@/lib/id'
import { isValidFactor, MAX_FACTOR } from '@/lib/units'
import { type Actor, diffFields, writeAudit } from './audit-service'
import { nextCounter } from './counter-service'
import { BusinessError } from './errors'
import { requirePermission } from './permission-service'

/**
 * Product catalog: products, their units (with independent prices) and barcodes.
 *
 * Stock fields (`stockQty`, `stockValue`) are NOT edited here. New products start at zero;
 * only the inventory service changes stock, always together with a stock movement.
 */

// ---------------------------------------------------------------- validation

const MAX_MONEY = 100_000_000_000 // ৳1,000,000,000.00 per unit is far beyond any real price
const money = z.number().int('Price must be in whole poisha').min(0, 'Price cannot be negative').max(MAX_MONEY, 'Price is too large')

export const productUnitSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Unit name is required').max(30, 'Unit name is too long'),
  symbol: z.string().trim().max(10).optional(),
  factor: z.number().refine(isValidFactor, `Conversion must be a whole number from 1 to ${MAX_FACTOR.toLocaleString('en-US')}`),
  isBase: z.boolean(),
  canPurchase: z.boolean(),
  canSell: z.boolean(),
  retailPrice: money,
  wholesalePrice: money,
  purchasePrice: money,
})
export type ProductUnitInput = z.infer<typeof productUnitSchema>

export const BARCODE_RE = /^[\x21-\x7e]{1,48}$/
export const productBarcodeSchema = z.object({
  code: z.string().trim().regex(BARCODE_RE, 'Barcode: 1–48 characters, letters, digits or symbols, no spaces'),
  unitId: z.string().optional(),
})
export type ProductBarcodeInput = z.infer<typeof productBarcodeSchema>

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(150, 'Name is too long'),
    sku: z
      .string()
      .trim()
      .max(40, 'SKU is too long')
      .regex(/^[A-Za-z0-9._\-/]*$/, 'SKU: letters, digits, . _ - / only')
      .optional()
      .default(''),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    description: z.string().trim().max(1000).optional().default(''),
    imageDataUrl: z
      .string()
      .refine((s) => s.startsWith('data:image/'), 'Invalid image')
      .refine((s) => s.length <= 600_000, 'Image is too large')
      .optional(),
    allowFraction: z.boolean(),
    minStockQty: z.number().int().min(0, 'Minimum stock cannot be negative').max(Number.MAX_SAFE_INTEGER),
    taxRate: z.number().int().min(0).max(10_000, 'Tax cannot exceed 100%'),
    trackBatches: z.boolean(),
    trackExpiry: z.boolean(),
    units: z.array(productUnitSchema).min(1, 'Add at least the base unit').max(20, 'At most 20 units per product'),
    barcodes: z.array(productBarcodeSchema).max(50, 'At most 50 barcodes per product'),
  })
  .superRefine((p, ctx) => {
    const bases = p.units.filter((u) => u.isBase)
    if (bases.length !== 1) ctx.addIssue({ code: 'custom', path: ['units'], message: 'Exactly one unit must be the base unit' })
    else if (bases[0].factor !== 1) ctx.addIssue({ code: 'custom', path: ['units'], message: 'The base unit must have conversion 1' })

    const names = new Set<string>()
    const ids = new Set<string>()
    p.units.forEach((u, i) => {
      const key = u.name.trim().toLowerCase()
      if (names.has(key)) ctx.addIssue({ code: 'custom', path: ['units', i, 'name'], message: `Unit "${u.name}" is listed twice` })
      names.add(key)
      if (ids.has(u.id)) ctx.addIssue({ code: 'custom', path: ['units', i, 'id'], message: 'Duplicate unit id' })
      ids.add(u.id)
    })
    if (!p.units.some((u) => u.canSell)) ctx.addIssue({ code: 'custom', path: ['units'], message: 'At least one unit must be sellable' })
    if (!p.units.some((u) => u.canPurchase)) ctx.addIssue({ code: 'custom', path: ['units'], message: 'At least one unit must be purchasable' })

    const codes = new Set<string>()
    p.barcodes.forEach((b, i) => {
      if (codes.has(b.code)) ctx.addIssue({ code: 'custom', path: ['barcodes', i, 'code'], message: `Barcode ${b.code} is listed twice` })
      codes.add(b.code)
      if (b.unitId && !ids.has(b.unitId)) ctx.addIssue({ code: 'custom', path: ['barcodes', i, 'unitId'], message: 'Barcode points to a unit that is not in the list' })
    })
    if (p.trackExpiry && !p.trackBatches) ctx.addIssue({ code: 'custom', path: ['trackExpiry'], message: 'Expiry tracking needs batch tracking' })
  })
export type ProductInput = z.input<typeof productInputSchema>
export type ProductData = z.output<typeof productInputSchema>

// ---------------------------------------------------------------- helpers

export const PRODUCT_TABLES = [db.products, db.productUnits, db.productBarcodes, db.categories, db.brands, db.counters, db.auditLogs]

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase()
}

async function assertSkuFree(sku: string, exceptId?: ID) {
  const clash = await db.products.where('sku').equals(sku).first()
  if (clash && clash.id !== exceptId) throw new BusinessError('duplicate_sku', `SKU ${sku} is already used by "${clash.name}".`)
}

async function generateSku(): Promise<string> {
  for (;;) {
    const sku = `P${String(await nextCounter('product')).padStart(5, '0')}`
    if (!(await db.products.where('sku').equals(sku).first())) return sku
  }
}

async function assertBarcodesFree(codes: string[], productId: ID) {
  if (codes.length === 0) return
  const clashes = await db.productBarcodes.where('code').anyOf(codes).toArray()
  const foreign = clashes.find((b) => b.productId !== productId)
  if (foreign) {
    const owner = await db.products.get(foreign.productId)
    throw new BusinessError('duplicate_barcode', `Barcode ${foreign.code} already belongs to "${owner?.name ?? 'another product'}".`)
  }
}

async function assertRefs(data: ProductData) {
  if (data.categoryId && !(await db.categories.get(data.categoryId))) throw new BusinessError('not_found', 'The selected category no longer exists.')
  if (data.brandId && !(await db.brands.get(data.brandId))) throw new BusinessError('not_found', 'The selected brand no longer exists.')
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
    isBase: u.isBase ? 1 : 0,
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

/** Product fields worth recording in the audit log (no image bytes, no cached stock). */
function auditView(p: Product) {
  const { imageDataUrl, stockQty: _q, stockValue: _v, createdAt: _c, updatedAt: _u, ...rest } = p
  return { ...rest, image: imageDataUrl ? '[image]' : undefined }
}

type PriceField = 'retailPrice' | 'wholesalePrice' | 'purchasePrice'
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

/** Whether the product has stock or any recorded history (movements, batches, document lines). */
export async function productHasHistory(productId: ID): Promise<boolean> {
  const p = await db.products.get(productId)
  if (!p) return false
  if (p.stockQty !== 0 || p.stockValue !== 0) return true
  const counts = await Promise.all([
    db.stockMovements.where('productId').equals(productId).count(),
    db.productBatches.where('productId').equals(productId).count(),
    db.saleItems.where('productId').equals(productId).count(),
    db.purchaseItems.where('productId').equals(productId).count(),
    db.saleReturnItems.where('productId').equals(productId).count(),
    db.purchaseReturnItems.where('productId').equals(productId).count(),
  ])
  return counts.some((c) => c > 0)
}

// ---------------------------------------------------------------- commands

export async function createProduct(actor: Actor, input: ProductInput): Promise<Product> {
  await requirePermission(actor, 'products.edit')
  const data = productInputSchema.parse(input)
  if (data.units.some((u) => u.retailPrice || u.wholesalePrice || u.purchasePrice)) {
    await requirePermission(actor, 'products.edit_price')
  }
  // The scope must be an async function: Dexie only keeps the transaction alive across native awaits then.
  return db.transaction('rw', PRODUCT_TABLES, async () => insertProduct(actor, data))
}

/**
 * Insert a validated product. Must run inside a transaction covering PRODUCT_TABLES
 * (used by createProduct and the CSV import, which inserts many products atomically).
 */
export async function insertProduct(actor: Actor, data: ProductData): Promise<Product> {
  const now = Date.now()
  const id = newId()
  await assertRefs(data)
  const sku = data.sku ? normalizeSku(data.sku) : await generateSku()
  await assertSkuFree(sku)
  await assertBarcodesFree(data.barcodes.map((b) => b.code), id)
  const clashUnit = await db.productUnits.where('id').anyOf(data.units.map((u) => u.id)).first()
  if (clashUnit) throw new BusinessError('invalid_unit', 'Unit ids must be new for a new product.')

  const units = buildUnits(id, data, now, new Map())
  const base = units[0]
  const product: Product = {
    id,
    name: data.name,
    sku,
    categoryId: data.categoryId || undefined,
    brandId: data.brandId || undefined,
    description: data.description || undefined,
    imageDataUrl: data.imageDataUrl,
    baseUnitName: base.name,
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
  }
  const barcodes: ProductBarcode[] = data.barcodes.map((b) => ({ id: newId(), code: b.code, productId: id, unitId: b.unitId || undefined, createdAt: now }))

  await db.products.add(product)
  await db.productUnits.bulkAdd(units)
  if (barcodes.length) await db.productBarcodes.bulkAdd(barcodes)
  await writeAudit(actor, {
    action: 'product.create',
    module: 'products',
    entityId: id,
    after: { ...auditView(product), units: units.map(unitAuditView), barcodes: barcodes.map((b) => b.code) },
  })
  return product
}

function unitAuditView(u: ProductUnit) {
  return { name: u.name, factor: u.factor, isBase: !!u.isBase, retail: u.retailPrice, wholesale: u.wholesalePrice, purchase: u.purchasePrice }
}

export async function updateProduct(actor: Actor, id: ID, input: ProductInput): Promise<Product> {
  await requirePermission(actor, 'products.edit')
  const data = productInputSchema.parse(input)
  const [currentUnits, hasHistory] = await Promise.all([db.productUnits.where('productId').equals(id).toArray(), productHasHistory(id)])
  const nextUnitsPreview = buildUnits(id, data, 0, new Map())
  const prices = priceChanges(currentUnits, nextUnitsPreview)
  if (prices.length) await requirePermission(actor, 'products.edit_price')
  const now = Date.now()

  return db.transaction('rw', [...PRODUCT_TABLES, db.productBatches], async () => {
    const current = await db.products.get(id)
    if (!current) throw new BusinessError('not_found', 'Product not found.')
    await assertRefs(data)
    const sku = data.sku ? normalizeSku(data.sku) : current.sku
    await assertSkuFree(sku, id)
    await assertBarcodesFree(data.barcodes.map((b) => b.code), id)

    const existingUnits = new Map(currentUnits.map((u) => [u.id, u]))
    const foreignUnit = (await db.productUnits.where('id').anyOf(data.units.map((u) => u.id)).toArray()).find((u) => u.productId !== id)
    if (foreignUnit) throw new BusinessError('invalid_unit', 'A unit in the list belongs to another product.')

    const oldBase = currentUnits.find((u) => u.isBase)
    const newBase = data.units.find((u) => u.isBase)!
    if (hasHistory && oldBase && oldBase.id !== newBase.id) {
      throw new BusinessError(
        'base_unit_locked',
        `The base unit cannot be replaced because this product already has stock or history (stock is counted in ${oldBase.name}). You can still rename it or add other units.`,
      )
    }
    if (current.trackBatches && !data.trackBatches) {
      const open = await db.productBatches.where('productId').equals(id).filter((b) => b.qtyRemaining > 0).count()
      if (open > 0) throw new BusinessError('batches_open', 'Batch tracking cannot be turned off while batches still hold stock.')
    }

    const units = buildUnits(id, data, now, existingUnits)
    const patch: Partial<Product> = {
      name: data.name,
      sku,
      categoryId: data.categoryId || undefined,
      brandId: data.brandId || undefined,
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

    const removedUnitIds = currentUnits.filter((u) => !data.units.some((x) => x.id === u.id)).map((u) => u.id)
    await db.products.put(next)
    if (removedUnitIds.length) await db.productUnits.bulkDelete(removedUnitIds)
    await db.productUnits.bulkPut(units)

    const oldBarcodes = await db.productBarcodes.where('productId').equals(id).toArray()
    const keep = new Map(oldBarcodes.map((b) => [b.code, b]))
    const barcodes: ProductBarcode[] = data.barcodes.map((b) => ({
      id: keep.get(b.code)?.id ?? newId(),
      code: b.code,
      productId: id,
      unitId: b.unitId || undefined,
      createdAt: keep.get(b.code)?.createdAt ?? now,
    }))
    await db.productBarcodes.bulkDelete(oldBarcodes.filter((b) => !data.barcodes.some((x) => x.code === b.code)).map((b) => b.id))
    if (barcodes.length) await db.productBarcodes.bulkPut(barcodes)

    const diff = diffFields(auditView(current), auditView(next))
    const unitsBefore = currentUnits.map(unitAuditView)
    const unitsAfter = units.map(unitAuditView)
    const unitsChanged = JSON.stringify(unitsBefore) !== JSON.stringify(unitsAfter)
    const codesBefore = oldBarcodes.map((b) => b.code).sort()
    const codesAfter = barcodes.map((b) => b.code).sort()
    const codesChanged = JSON.stringify(codesBefore) !== JSON.stringify(codesAfter)
    if (diff.changed || unitsChanged || codesChanged) {
      await writeAudit(actor, {
        action: 'product.update',
        module: 'products',
        entityId: id,
        before: { ...diff.before, ...(unitsChanged && { units: unitsBefore }), ...(codesChanged && { barcodes: codesBefore }) },
        after: { ...diff.after, ...(unitsChanged && { units: unitsAfter }), ...(codesChanged && { barcodes: codesAfter }) },
      })
    }
    if (prices.length) {
      await writeAudit(actor, { action: 'product.price_change', module: 'products', entityId: id, before: undefined, after: prices })
    }
    return next
  })
}

export async function setProductStatus(actor: Actor, id: ID, status: RecordStatus, reason?: string): Promise<void> {
  await requirePermission(actor, 'products.edit')
  await db.transaction('rw', db.products, db.auditLogs, async () => {
    const current = await db.products.get(id)
    if (!current) throw new BusinessError('not_found', 'Product not found.')
    if (current.status === status) return
    await db.products.update(id, { status, updatedAt: Date.now() })
    await writeAudit(actor, {
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
export async function deleteProduct(actor: Actor, id: ID): Promise<void> {
  await requirePermission(actor, 'products.edit')
  if (await productHasHistory(id)) {
    throw new BusinessError('has_history', 'This product has stock or transaction history, so it cannot be deleted. Archive it instead.')
  }
  await db.transaction('rw', [db.products, db.productUnits, db.productBarcodes, db.auditLogs], async () => {
    const current = await db.products.get(id)
    if (!current) throw new BusinessError('not_found', 'Product not found.')
    const units = await db.productUnits.where('productId').equals(id).toArray()
    const barcodes = await db.productBarcodes.where('productId').equals(id).toArray()
    await db.productBarcodes.bulkDelete(barcodes.map((b) => b.id))
    await db.productUnits.bulkDelete(units.map((u) => u.id))
    await db.products.delete(id)
    await writeAudit(actor, {
      action: 'product.delete',
      module: 'products',
      entityId: id,
      before: { ...auditView(current), units: units.map(unitAuditView), barcodes: barcodes.map((b) => b.code) },
    })
  })
}

// ---------------------------------------------------------------- bulk price update

export interface BulkPriceInput {
  productIds: ID[]
  field: PriceField
  /** 'base' = only the base unit; 'all' = every unit of each product. */
  scope: 'base' | 'all'
  /** percent: value in basis points (+500 = +5%); amount: value in poisha per unit. Negative lowers prices. */
  method: 'percent' | 'amount'
  value: number
  /** Round results to whole taka (100 poisha) or keep poisha. */
  roundTo: 1 | 100
  reason?: string
}

export function adjustPrice(price: Money, method: BulkPriceInput['method'], value: number, roundTo: 1 | 100): Money {
  const raw = method === 'percent' ? price + divRound(BigInt(price) * BigInt(value), 10000n) : price + value
  return roundTo === 1 ? raw : divRound(raw, roundTo) * roundTo
}

/** Apply one price rule to many products atomically. Returns the number of unit prices changed. */
export async function bulkUpdatePrices(actor: Actor, input: BulkPriceInput): Promise<number> {
  await requirePermission(actor, 'products.edit', 'products.edit_price')
  if (input.productIds.length === 0) throw new BusinessError('empty', 'Select at least one product.')
  if (!Number.isSafeInteger(input.value) || input.value === 0) throw new BusinessError('invalid', 'Enter a non-zero change.')
  if (input.method === 'percent' && input.value <= -10000) throw new BusinessError('invalid', 'A decrease must be less than 100%.')
  const now = Date.now()

  return db.transaction('rw', db.products, db.productUnits, db.auditLogs, async () => {
    let changed = 0
    for (const productId of input.productIds) {
      const product = await db.products.get(productId)
      if (!product) continue
      const units = await db.productUnits.where('productId').equals(productId).toArray()
      const changes: PriceChange[] = []
      for (const u of units) {
        if (input.scope === 'base' && !u.isBase) continue
        const before = u[input.field]
        if (before === 0 && input.method === 'percent') continue
        const after = adjustPrice(before, input.method, input.value, input.roundTo)
        if (after < 0) throw new BusinessError('negative_price', `"${product.name}" (${u.name}) would get a negative price.`)
        if (after > MAX_MONEY) throw new BusinessError('invalid', `"${product.name}" (${u.name}) would get a price that is too large.`)
        if (after === before) continue
        await db.productUnits.update(u.id, { [input.field]: after, updatedAt: now })
        changes.push({ unit: u.name, field: input.field, before, after })
      }
      if (changes.length) {
        changed += changes.length
        await db.products.update(productId, { updatedAt: now })
        await writeAudit(actor, {
          action: 'product.price_change',
          module: 'products',
          entityId: productId,
          after: changes,
          reason: input.reason?.trim() || 'Bulk price update',
        })
      }
    }
    return changed
  })
}

// ---------------------------------------------------------------- barcodes

/**
 * Next unused in-store EAN-13 code ("2…", reserved for internal use).
 * `exclude` covers codes typed into an unsaved form.
 */
export async function generateBarcode(exclude: readonly string[] = []): Promise<string> {
  return db.transaction('rw', db.counters, db.productBarcodes, async () => {
    for (;;) {
      const code = makeInStoreEan13(await nextCounter('barcode'))
      if (!exclude.includes(code) && !(await db.productBarcodes.where('code').equals(code).first())) return code
    }
  })
}

/** Give each listed product that has no barcode yet one generated in-store code (base unit). */
export async function assignGeneratedBarcodes(actor: Actor, productIds: readonly ID[]): Promise<number> {
  await requirePermission(actor, 'products.edit')
  return db.transaction('rw', db.products, db.productBarcodes, db.counters, db.auditLogs, async () => {
    let added = 0
    for (const productId of productIds) {
      if (!(await db.products.get(productId))) continue
      if ((await db.productBarcodes.where('productId').equals(productId).count()) > 0) continue
      let code: string
      do code = makeInStoreEan13(await nextCounter('barcode'))
      while (await db.productBarcodes.where('code').equals(code).first())
      await db.productBarcodes.add({ id: newId(), code, productId, createdAt: Date.now() })
      await writeAudit(actor, { action: 'product.barcode_generate', module: 'products', entityId: productId, after: { barcode: code } })
      added++
    }
    return added
  })
}

/** Resolve a scanned / typed barcode to its product and (optionally) package unit. */
export async function findByBarcode(code: string): Promise<{ product: Product; unit?: ProductUnit } | undefined> {
  const bc = await db.productBarcodes.where('code').equals(code.trim()).first()
  if (!bc) return undefined
  const product = await db.products.get(bc.productId)
  if (!product) return undefined
  const unit = bc.unitId ? await db.productUnits.get(bc.unitId) : undefined
  return { product, unit }
}

// ---------------------------------------------------------------- queries

export interface ProductDetail {
  product: Product
  units: ProductUnit[]
  barcodes: ProductBarcode[]
  category?: Category
  brand?: Brand
}

export async function getProductDetail(id: ID): Promise<ProductDetail | null> {
  const product = await db.products.get(id)
  if (!product) return null
  const [units, barcodes, category, brand] = await Promise.all([
    db.productUnits.where('productId').equals(id).sortBy('sortOrder'),
    db.productBarcodes.where('productId').equals(id).toArray(),
    product.categoryId ? db.categories.get(product.categoryId) : undefined,
    product.brandId ? db.brands.get(product.brandId) : undefined,
  ])
  return { product, units, barcodes, category, brand }
}

/** Convert a stored product back into editable input (round-trips through updateProduct). */
export function detailToInput(d: ProductDetail): ProductInput {
  return {
    name: d.product.name,
    sku: d.product.sku,
    categoryId: d.product.categoryId,
    brandId: d.product.brandId,
    description: d.product.description ?? '',
    imageDataUrl: d.product.imageDataUrl,
    allowFraction: d.product.allowFraction,
    minStockQty: d.product.minStockQty,
    taxRate: d.product.taxRate,
    trackBatches: d.product.trackBatches,
    trackExpiry: d.product.trackExpiry,
    units: d.units.map((u) => ({
      id: u.id,
      name: u.name,
      symbol: u.symbol,
      factor: u.factor,
      isBase: !!u.isBase,
      canPurchase: u.canPurchase,
      canSell: u.canSell,
      retailPrice: u.retailPrice,
      wholesalePrice: u.wholesalePrice,
      purchasePrice: u.purchasePrice,
    })),
    barcodes: d.barcodes.map((b) => ({ code: b.code, unitId: b.unitId })),
  }
}
