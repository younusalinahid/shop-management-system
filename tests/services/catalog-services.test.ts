// @vitest-environment node
import { and, asc, count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import { adjustPrice, detailToInput, type ProductInput } from '@/lib/product'
import { parseProductCsv, productCsvTemplate } from '@/lib/product-csv'
import { type Db, getDb } from '@/server/db'
import { auditLogs, categories, productBarcodes, products, productUnits, stockMovements } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { createBrand, createCategory, setCategoryStatus, updateCategory } from '@/server/services/catalog'
import {
  bulkUpdatePrices,
  createProduct,
  deleteProduct,
  findByBarcode,
  generateBarcode,
  getProductDetail,
  setProductStatus,
  updateProduct,
} from '@/server/services/product'
import { exportProductsCsv, importProducts } from '@/server/services/product-csv'

let db: Db
let owner: Actor
const cashier: Actor = { id: 'cashier-1', name: 'Rafi', role: 'cashier' }

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
})

function unit(name: string, factor: number, prices: Partial<Record<'retailPrice' | 'wholesalePrice' | 'purchasePrice', number>> = {}, extra = {}) {
  return { id: newId(), name, factor, isBase: factor === 1, canPurchase: true, canSell: true, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0, ...prices, ...extra }
}

function chocolate(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: '1 Taka Chocolate',
    sku: 'choc1',
    allowFraction: false,
    minStockQty: 70,
    taxRate: 0,
    trackBatches: false,
    trackExpiry: false,
    units: [unit('Piece', 1, { retailPrice: 100, wholesalePrice: 90, purchasePrice: 80 }), unit('Packet', 35, { retailPrice: 3300, wholesalePrice: 3000, purchasePrice: 2700 })],
    barcodes: [],
    ...overrides,
  }
}

const unitsOf = (productId: string) => db.select().from(productUnits).where(eq(productUnits.productId, productId)).orderBy(asc(productUnits.sortOrder))
const auditCount = async (action: string) => (await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.action, action)))[0].n

describe('categories and brands', () => {
  it('creates, renames and archives with case-insensitive unique names', async () => {
    const grocery = await createCategory(db, owner, { name: 'Grocery' })
    await expect(createCategory(db, owner, { name: ' grocery ' })).rejects.toThrow('already exists')
    const rice = await createCategory(db, owner, { name: 'Rice', parentId: grocery.id })
    await expect(updateCategory(db, owner, grocery.id, { name: 'Grocery', parentId: rice.id })).rejects.toThrow('inside itself')
    await setCategoryStatus(db, owner, rice.id, 'archived')
    expect((await db.select().from(categories).where(eq(categories.id, rice.id)))[0].status).toBe('archived')
    await expect(createCategory(db, owner, { name: 'RICE' })).rejects.toThrow('archived')
    expect((await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.module, 'catalog')))[0].n).toBe(3)
  })

  it('blocks cashiers from editing the catalog', async () => {
    await expect(createBrand(db, cashier, { name: 'Pran' })).rejects.toThrow('permission')
  })
})

describe('product service', () => {
  it('creates a product with independent unit prices, normalised SKU and zero stock', async () => {
    const p = await createProduct(db, owner, chocolate())
    expect(p.sku).toBe('CHOC1')
    expect(p.baseUnitName).toBe('Piece')
    expect(p.stockQty).toBe(0)
    const d = (await getProductDetail(db, p.id))!
    expect(d.units.map((u) => [u.name, u.factor, u.isBase, u.retailPrice])).toEqual([
      ['Piece', 1, true, 100],
      ['Packet', 35, false, 3300],
    ])
    // Packet price is NOT 35 × piece price.
    expect(d.units[1].retailPrice).not.toBe(35 * d.units[0].retailPrice)
    expect(d.hasHistory).toBe(false)
    expect(await auditCount('product.create')).toBe(1)
  })

  it('auto-generates a SKU and rejects duplicates', async () => {
    const a = await createProduct(db, owner, chocolate({ sku: '' }))
    expect(a.sku).toMatch(/^P\d{5}$/)
    await expect(createProduct(db, owner, chocolate({ name: 'Other', sku: 'CHOC1 ' }))).resolves.toBeTruthy()
    await expect(createProduct(db, owner, chocolate({ name: 'Third', sku: 'choc1' }))).rejects.toThrow('already used')
  })

  it('rejects invalid unit setups', async () => {
    await expect(createProduct(db, owner, chocolate({ units: [unit('Packet', 35)] }))).rejects.toThrow('base unit')
    await expect(createProduct(db, owner, chocolate({ units: [unit('Piece', 1), unit('Packet', 0)] }))).rejects.toThrow('Conversion')
    await expect(createProduct(db, owner, chocolate({ units: [unit('Piece', 1), unit('Packet', 2.5)] }))).rejects.toThrow('Conversion')
    await expect(createProduct(db, owner, chocolate({ units: [unit('Piece', 1), unit('piece', 12)] }))).rejects.toThrow('twice')
    await expect(
      createProduct(db, owner, chocolate({ units: [unit('Piece', 1, {}, { canSell: false }), unit('Packet', 35, {}, { canSell: false })] })),
    ).rejects.toThrow('sellable')
    expect((await db.select({ n: count() }).from(products))[0].n).toBe(0)
  })

  it('keeps barcodes unique across products and binds package barcodes to a unit', async () => {
    const input = chocolate()
    const packetId = input.units[1].id
    input.barcodes = [{ code: '8941100000011' }, { code: '8941100000028', unitId: packetId }]
    const p = await createProduct(db, owner, input)
    await expect(createProduct(db, owner, chocolate({ sku: 'X', barcodes: [{ code: '8941100000011' }] }))).rejects.toThrow('already belongs')
    const hit = await findByBarcode(db, '8941100000028')
    expect(hit?.product.id).toBe(p.id)
    expect(hit?.unit?.name).toBe('Packet')
    expect((await findByBarcode(db, '8941100000011'))?.unit).toBeUndefined()
    expect(await findByBarcode(db, 'nope')).toBeNull()
  })

  it('generates unique in-store EAN-13 codes, skipping excluded ones', async () => {
    const a = await generateBarcode(db, owner)
    const b = await generateBarcode(db, owner, [])
    expect(a).not.toBe(b)
    expect(a.startsWith('2')).toBe(true)
    await expect(generateBarcode(db, cashier)).rejects.toThrow('permission')
  })

  it('updates units and prices, auditing price changes; cashiers cannot change products', async () => {
    const p = await createProduct(db, owner, chocolate({ barcodes: [] }))
    const input = detailToInput((await getProductDetail(db, p.id))!)
    input.units[1].retailPrice = 3400
    input.units.push(unit('Box', 24 * 35, { retailPrice: 75_000 }))
    input.barcodes = [{ code: 'BOX-1', unitId: input.units[2].id }]
    await expect(updateProduct(db, cashier, p.id, input)).rejects.toThrow('permission')
    await updateProduct(db, owner, p.id, input)
    const d = (await getProductDetail(db, p.id))!
    expect(d.units.map((u) => u.name)).toEqual(['Piece', 'Packet', 'Box'])
    expect((await findByBarcode(db, 'BOX-1'))?.unit?.name).toBe('Box')
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'product.price_change'))
    expect(log.after).toEqual([
      { unit: 'Packet', field: 'retailPrice', before: 3300, after: 3400 },
      { unit: 'Box', field: 'retailPrice', before: 0, after: 75_000 },
    ])
  })

  it('locks the base unit once the product has history, and archives instead of deleting', async () => {
    const p = await createProduct(db, owner, chocolate())
    await db.insert(stockMovements).values({ productId: p.id, type: 'opening', qtyChange: 35, valueChange: 2700, balanceAfter: 35, userId: owner.id, createdAt: Date.now() })
    await db.update(products).set({ stockQty: 35, stockValue: 2700 }).where(eq(products.id, p.id))

    const input = detailToInput((await getProductDetail(db, p.id))!)
    input.units = [unit('Gram', 1), ...input.units.map((u) => ({ ...u, isBase: false, factor: u.factor === 1 ? 2 : u.factor }))]
    await expect(updateProduct(db, owner, p.id, input)).rejects.toThrow('base unit cannot be replaced')

    // Renaming the base unit is fine.
    const rename = detailToInput((await getProductDetail(db, p.id))!)
    rename.units[0].name = 'Pcs'
    await updateProduct(db, owner, p.id, rename)
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].baseUnitName).toBe('Pcs')

    await expect(deleteProduct(db, owner, p.id)).rejects.toThrow('Archive it instead')
    await setProductStatus(db, owner, p.id, 'archived')
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].status).toBe('archived')
  })

  it('deletes an unused product with its units and barcodes', async () => {
    const p = await createProduct(db, owner, chocolate({ barcodes: [{ code: 'ABC123' }] }))
    await deleteProduct(db, owner, p.id)
    expect(await getProductDetail(db, p.id)).toBeNull()
    expect(await unitsOf(p.id)).toHaveLength(0)
    expect(await db.select().from(productBarcodes)).toHaveLength(0)
    expect(await auditCount('product.delete')).toBe(1)
  })

  it('bulk-updates prices atomically and refuses negative results', async () => {
    const a = await createProduct(db, owner, chocolate())
    const b = await createProduct(db, owner, chocolate({ sku: 'B', name: 'B' }))
    const n = await bulkUpdatePrices(db, owner, { productIds: [a.id, b.id], field: 'retailPrice', scope: 'all', method: 'percent', value: 1000, roundTo: 1 })
    expect(n).toBe(4)
    expect((await unitsOf(a.id)).map((u) => u.retailPrice)).toEqual([110, 3630])

    await expect(
      bulkUpdatePrices(db, owner, { productIds: [a.id, b.id], field: 'retailPrice', scope: 'all', method: 'amount', value: -200, roundTo: 1 }),
    ).rejects.toThrow('negative')
    // Nothing changed for either product: the whole update rolled back.
    expect((await unitsOf(b.id)).map((u) => u.retailPrice)).toEqual([110, 3630])
    await expect(bulkUpdatePrices(db, cashier, { productIds: [a.id], field: 'retailPrice', scope: 'all', method: 'percent', value: 100, roundTo: 1 })).rejects.toThrow(
      'permission',
    )
  })

  it('rounds adjusted prices', () => {
    expect(adjustPrice(7800, 'percent', 500, 1)).toBe(8190)
    expect(adjustPrice(7850, 'percent', 500, 100)).toBe(8200)
    expect(adjustPrice(7800, 'amount', -50, 1)).toBe(7750)
  })

  it('enforces one base unit and unique unit names in the database itself', async () => {
    const p = await createProduct(db, owner, chocolate())
    const now = Date.now()
    const row = { productId: p.id, factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0, sortOrder: 9, createdAt: now, updatedAt: now }
    await expect(db.insert(productUnits).values({ ...row, id: newId(), name: 'Another base' })).rejects.toThrow()
    await expect(db.insert(productUnits).values({ ...row, id: newId(), name: 'PACKET', isBase: false, factor: 10 })).rejects.toThrow()
    expect(await db.select({ n: count() }).from(productUnits).where(and(eq(productUnits.productId, p.id), eq(productUnits.isBase, true)))).toEqual([{ n: 1 }])
  })

})

describe('product CSV', () => {
  it('imports the template atomically, creating categories, and skips existing SKUs on re-import', async () => {
    const parsed = parseProductCsv(productCsvTemplate())
    expect(parsed.errors).toEqual([])
    expect(parsed.products).toHaveLength(2)
    const res = await importProducts(db, owner, parsed)
    expect(res).toMatchObject({ created: 2, createdCategories: 2 })

    const [rice] = await db.select().from(products).where(eq(products.sku, 'RICE-MINIKET'))
    expect((await unitsOf(rice.id)).map((u) => [u.name, u.factor, u.retailPrice])).toEqual([
      ['Gram', 1, 8],
      ['KG', 1000, 7800],
      ['Sack', 25_000, 190_000],
    ])

    const again = await importProducts(db, owner, parseProductCsv(await exportProductsCsv(db, owner, {})))
    expect(again.created).toBe(0)
    expect(again.skipped).toHaveLength(2)
  })

  it('reports row errors and refuses to import', async () => {
    const parsed = parseProductCsv('sku,name,unit,factor,is_base,retail_price\nX1,Bad,Piece,1,yes,abc\nX2,Bad2,Box,0,yes,1\n')
    expect(parsed.errors.length).toBeGreaterThanOrEqual(2)
    expect(parsed.errors[0].line).toBe(2)
    await expect(importProducts(db, owner, parsed)).rejects.toThrow('Fix the errors')
    expect((await db.select({ n: count() }).from(products))[0].n).toBe(0)
  })

  it('hides purchase prices from roles without cost access', async () => {
    await createProduct(db, owner, chocolate())
    expect(await exportProductsCsv(db, cashier, {})).not.toContain('27')
    expect(await exportProductsCsv(db, owner, {})).toContain('27')
  })
})
