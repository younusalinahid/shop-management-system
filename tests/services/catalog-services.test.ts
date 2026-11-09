import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { newId } from '@/lib/id'
import type { Actor } from '@/services/audit-service'
import { createInitialOwner, createUser } from '@/services/auth-service'
import { createBrand, createCategory, setCategoryStatus, updateCategory } from '@/services/catalog-service'
import { exportProductsCsv, importProducts, parseProductCsv, productCsvTemplate } from '@/services/product-csv-service'
import {
  adjustPrice,
  bulkUpdatePrices,
  createProduct,
  deleteProduct,
  findByBarcode,
  generateBarcode,
  getProductDetail,
  detailToInput,
  setProductStatus,
  updateProduct,
  type ProductInput,
} from '@/services/product-service'

let owner: Actor
let cashier: Actor

beforeEach(async () => {
  const o = await createInitialOwner({ name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name }
  const c = await createUser(owner, { name: 'Rafi', username: 'rafi', role: 'cashier', pin: '1111' })
  cashier = { id: c.id, name: c.name }
})

function unit(name: string, factor: number, prices: Partial<Record<'retailPrice' | 'wholesalePrice' | 'purchasePrice', number>> = {}, extra = {}) {
  return {
    id: newId(),
    name,
    factor,
    isBase: factor === 1,
    canPurchase: true,
    canSell: true,
    retailPrice: 0,
    wholesalePrice: 0,
    purchasePrice: 0,
    ...prices,
    ...extra,
  }
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

describe('categories and brands', () => {
  it('creates, renames and archives with case-insensitive unique names', async () => {
    const grocery = await createCategory(owner, { name: 'Grocery' })
    await expect(createCategory(owner, { name: ' grocery ' })).rejects.toThrow('already exists')
    const rice = await createCategory(owner, { name: 'Rice', parentId: grocery.id })
    await expect(updateCategory(owner, grocery.id, { name: 'Grocery', parentId: rice.id })).rejects.toThrow('inside itself')
    await setCategoryStatus(owner, rice.id, 'archived')
    expect((await db.categories.get(rice.id))?.status).toBe('archived')
    await expect(createCategory(owner, { name: 'RICE' })).rejects.toThrow('archived')
    expect(await db.auditLogs.where('module').equals('catalog').count()).toBe(3)
  })

  it('blocks cashiers from editing the catalog', async () => {
    await expect(createBrand(cashier, { name: 'Pran' })).rejects.toThrow('permission')
  })
})

describe('product-service', () => {
  it('creates a product with independent unit prices, normalised SKU and zero stock', async () => {
    const p = await createProduct(owner, chocolate())
    expect(p.sku).toBe('CHOC1')
    expect(p.baseUnitName).toBe('Piece')
    expect(p.stockQty).toBe(0)
    const d = (await getProductDetail(p.id))!
    expect(d.units.map((u) => [u.name, u.factor, u.isBase, u.retailPrice])).toEqual([
      ['Piece', 1, 1, 100],
      ['Packet', 35, 0, 3300],
    ])
    // Packet price is NOT 35 × piece price.
    expect(d.units[1].retailPrice).not.toBe(35 * d.units[0].retailPrice)
    expect(await db.auditLogs.where('action').equals('product.create').count()).toBe(1)
  })

  it('auto-generates a SKU and rejects duplicates', async () => {
    const a = await createProduct(owner, chocolate({ sku: '' }))
    expect(a.sku).toMatch(/^P\d{5}$/)
    await expect(createProduct(owner, chocolate({ name: 'Other', sku: 'CHOC1 ' }))).resolves.toBeTruthy()
    await expect(createProduct(owner, chocolate({ name: 'Third', sku: 'choc1' }))).rejects.toThrow('already used')
  })

  it('rejects invalid unit setups', async () => {
    await expect(createProduct(owner, chocolate({ units: [unit('Packet', 35)] }))).rejects.toThrow('base unit')
    await expect(createProduct(owner, chocolate({ units: [unit('Piece', 1), unit('Packet', 0)] }))).rejects.toThrow('Conversion')
    await expect(createProduct(owner, chocolate({ units: [unit('Piece', 1), unit('Packet', 2.5)] }))).rejects.toThrow('Conversion')
    await expect(createProduct(owner, chocolate({ units: [unit('Piece', 1), unit('piece', 12)] }))).rejects.toThrow('twice')
    await expect(
      createProduct(owner, chocolate({ units: [unit('Piece', 1, {}, { canSell: false }), unit('Packet', 35, {}, { canSell: false })] })),
    ).rejects.toThrow('sellable')
  })

  it('keeps barcodes unique across products and binds package barcodes to a unit', async () => {
    const input = chocolate()
    const packetId = input.units[1].id
    input.barcodes = [{ code: '8941100000011' }, { code: '8941100000028', unitId: packetId }]
    const p = await createProduct(owner, input)
    await expect(createProduct(owner, chocolate({ sku: 'X', barcodes: [{ code: '8941100000011' }] }))).rejects.toThrow('already belongs')
    const hit = await findByBarcode('8941100000028')
    expect(hit?.product.id).toBe(p.id)
    expect(hit?.unit?.name).toBe('Packet')
    expect((await findByBarcode('8941100000011'))?.unit).toBeUndefined()
  })

  it('generates unique in-store EAN-13 codes', async () => {
    const a = await generateBarcode()
    const b = await generateBarcode([])
    expect(a).not.toBe(b)
    expect(a.startsWith('2')).toBe(true)
    const c = await generateBarcode([makeNext(b)])
    expect(c).not.toBe(makeNext(b))
  })

  it('updates units and prices, auditing price changes; cashiers cannot change prices', async () => {
    const p = await createProduct(owner, chocolate())
    const input = detailToInput((await getProductDetail(p.id))!)
    input.units[1].retailPrice = 3400
    input.units.push(unit('Box', 24 * 35, { retailPrice: 75_000 }))
    await expect(updateProduct(cashier, p.id, input)).rejects.toThrow('permission')
    await updateProduct(owner, p.id, input)
    const d = (await getProductDetail(p.id))!
    expect(d.units.map((u) => u.name)).toEqual(['Piece', 'Packet', 'Box'])
    const log = await db.auditLogs.where('action').equals('product.price_change').first()
    expect(log?.after).toEqual([
      { unit: 'Packet', field: 'retailPrice', before: 3300, after: 3400 },
      { unit: 'Box', field: 'retailPrice', before: 0, after: 75_000 },
    ])
  })

  it('locks the base unit once the product has history, and archives instead of deleting', async () => {
    const p = await createProduct(owner, chocolate())
    await db.stockMovements.add({ id: newId(), productId: p.id, type: 'opening', qtyChange: 35, valueChange: 2700, balanceAfter: 35, userId: owner.id, createdAt: Date.now() })
    await db.products.update(p.id, { stockQty: 35, stockValue: 2700 })

    const input = detailToInput((await getProductDetail(p.id))!)
    input.units = [unit('Gram', 1), ...input.units.map((u) => ({ ...u, isBase: false, factor: u.factor === 1 ? 2 : u.factor }))]
    await expect(updateProduct(owner, p.id, input)).rejects.toThrow('base unit cannot be replaced')

    // Renaming the base unit is fine.
    const rename = detailToInput((await getProductDetail(p.id))!)
    rename.units[0].name = 'Pcs'
    await updateProduct(owner, p.id, rename)
    expect((await db.products.get(p.id))?.baseUnitName).toBe('Pcs')

    await expect(deleteProduct(owner, p.id)).rejects.toThrow('Archive it instead')
    await setProductStatus(owner, p.id, 'archived')
    expect((await db.products.get(p.id))?.status).toBe('archived')
  })

  it('deletes an unused product with its units and barcodes', async () => {
    const p = await createProduct(owner, chocolate({ barcodes: [{ code: 'ABC123' }] }))
    await deleteProduct(owner, p.id)
    expect(await db.products.get(p.id)).toBeUndefined()
    expect(await db.productUnits.where('productId').equals(p.id).count()).toBe(0)
    expect(await db.productBarcodes.count()).toBe(0)
  })

  it('bulk-updates prices atomically and refuses negative results', async () => {
    const a = await createProduct(owner, chocolate())
    const b = await createProduct(owner, chocolate({ sku: 'B', name: 'B' }))
    const n = await bulkUpdatePrices(owner, { productIds: [a.id, b.id], field: 'retailPrice', scope: 'all', method: 'percent', value: 1000, roundTo: 1 })
    expect(n).toBe(4)
    const units = await db.productUnits.where('productId').equals(a.id).sortBy('sortOrder')
    expect(units.map((u) => u.retailPrice)).toEqual([110, 3630])

    await expect(
      bulkUpdatePrices(owner, { productIds: [a.id, b.id], field: 'retailPrice', scope: 'all', method: 'amount', value: -200, roundTo: 1 }),
    ).rejects.toThrow('negative')
    // Nothing changed for either product.
    expect((await db.productUnits.where('productId').equals(b.id).sortBy('sortOrder')).map((u) => u.retailPrice)).toEqual([110, 3630])
    await expect(bulkUpdatePrices(cashier, { productIds: [a.id], field: 'retailPrice', scope: 'all', method: 'percent', value: 100, roundTo: 1 })).rejects.toThrow('permission')
  })

  it('rounds adjusted prices', () => {
    expect(adjustPrice(7800, 'percent', 500, 1)).toBe(8190)
    expect(adjustPrice(7850, 'percent', 500, 100)).toBe(8200)
    expect(adjustPrice(7800, 'amount', -50, 1)).toBe(7750)
  })
})

describe('product CSV', () => {
  it('imports the template atomically, creating categories, and round-trips through export', async () => {
    const parsed = parseProductCsv(productCsvTemplate())
    expect(parsed.errors).toEqual([])
    expect(parsed.products).toHaveLength(2)
    const res = await importProducts(owner, parsed)
    expect(res).toMatchObject({ created: 2, createdCategories: 2 })

    const rice = await db.products.where('sku').equals('RICE-MINIKET').first()
    const units = await db.productUnits.where('productId').equals(rice!.id).sortBy('sortOrder')
    expect(units.map((u) => [u.name, u.factor, u.retailPrice])).toEqual([
      ['Gram', 1, 8],
      ['KG', 1000, 7800],
      ['Sack', 25_000, 190_000],
    ])

    // Re-importing skips existing SKUs instead of overwriting them.
    const again = await importProducts(owner, parseProductCsv(await exportProductsCsv({ includeCost: true })))
    expect(again.created).toBe(0)
    expect(again.skipped).toHaveLength(2)
  })

  it('reports row errors and writes nothing', async () => {
    const bad = 'sku,name,unit,factor,is_base,retail_price\nX1,Bad,Piece,1,yes,abc\nX2,Bad2,Box,0,yes,1\n'
    const parsed = parseProductCsv(bad)
    expect(parsed.errors.length).toBeGreaterThanOrEqual(2)
    expect(parsed.errors[0].line).toBe(2)
    await expect(importProducts(owner, parsed)).rejects.toThrow('Fix the errors')
    expect(await db.products.count()).toBe(0)
  })

  it('hides purchase prices unless requested', async () => {
    await createProduct(owner, chocolate())
    const text = await exportProductsCsv({ includeCost: false })
    expect(text).not.toContain('27')
    expect(await exportProductsCsv({ includeCost: true })).toContain('27')
  })
})

/** The EAN-13 that would follow `code` in the in-store sequence. */
function makeNext(code: string): string {
  const seq = Number(code.slice(1, 12)) + 1
  const first12 = '2' + String(seq).padStart(11, '0')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return first12 + ((10 - (sum % 10)) % 10)
}
