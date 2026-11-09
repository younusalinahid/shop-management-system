import { asc, eq, inArray } from 'drizzle-orm'
import type { ID } from '@/types/db'
import { toCsv } from '@/lib/csv'
import { integerToDecimalString } from '@/lib/decimal'
import { BusinessError } from '@/lib/errors'
import { moneyToInput } from '@/lib/money'
import { can } from '@/lib/permissions'
import { normalizeSku } from '@/lib/product'
import { type ImportResult, type ParsedImport, PRODUCT_CSV_COLUMNS, yesNo } from '@/lib/product-csv'
import type { Db } from '../db'
import { brands, categories, productBarcodes, products, productUnits } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { insertProduct } from './product'

/** Product CSV export and import (format: see src/lib/product-csv.ts). */

/** Export every product (or the given ids). Purchase prices are blank for roles that can't see cost. */
export async function exportProductsCsv(db: Db, actor: Actor, opts: { productIds?: ID[] }): Promise<string> {
  assertCan(actor, 'products.view')
  const includeCost = can(actor.role, 'products.view_cost')
  const productRows = await db
    .select()
    .from(products)
    .where(opts.productIds?.length ? inArray(products.id, opts.productIds) : undefined)
    .orderBy(asc(products.name))
  const [units, barcodes, categoryRows, brandRows] = await Promise.all([
    db.select().from(productUnits),
    db.select().from(productBarcodes),
    db.select({ id: categories.id, name: categories.name }).from(categories),
    db.select({ id: brands.id, name: brands.name }).from(brands),
  ])
  const unitsBy = groupBy(units, (u) => u.productId)
  const codesBy = groupBy(barcodes, (b) => `${b.productId}|${b.unitId ?? ''}`)
  const catName = new Map(categoryRows.map((c) => [c.id, c.name]))
  const brandName = new Map(brandRows.map((b) => [b.id, b.name]))

  const rows: unknown[][] = [[...PRODUCT_CSV_COLUMNS]]
  for (const p of productRows) {
    const list = (unitsBy.get(p.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
    for (const u of list) {
      // Base-unit row carries barcodes without a unit binding.
      const codes = [...(codesBy.get(`${p.id}|${u.id}`) ?? []), ...(u.isBase ? (codesBy.get(`${p.id}|`) ?? []) : [])]
      rows.push([
        p.sku,
        p.name,
        p.categoryId ? catName.get(p.categoryId) : '',
        p.brandId ? brandName.get(p.brandId) : '',
        p.description ?? '',
        yesNo(p.allowFraction),
        integerToDecimalString(p.taxRate, 2),
        p.minStockQty,
        yesNo(p.trackBatches),
        yesNo(p.trackExpiry),
        p.status,
        u.name,
        u.symbol ?? '',
        u.factor,
        yesNo(!!u.isBase),
        yesNo(u.canPurchase),
        yesNo(u.canSell),
        moneyToInput(u.retailPrice),
        moneyToInput(u.wholesalePrice),
        includeCost ? moneyToInput(u.purchasePrice) : '',
        codes.map((c) => c.code).join('|'),
      ])
    }
  }
  return toCsv(rows)
}

/** A blank template with the chocolate and rice examples, for users preparing an import. */


/**
 * Import a parsed file atomically: either every new product is created or none is.
 * Products whose SKU already exists are skipped (never overwritten). Missing categories
 * and brands are created by name.
 */
export async function importProducts(db: Db, actor: Actor, parsed: ParsedImport): Promise<ImportResult> {
  assertCan(actor, 'products.edit', 'products.edit_price')
  if (parsed.errors.length) throw new BusinessError('invalid', 'Fix the errors in the file before importing.')
  const now = Date.now()

  return db.transaction(async (tx) => {
    const [categoryRows, brandRows] = await Promise.all([
      tx.select({ id: categories.id, name: categories.name }).from(categories),
      tx.select({ id: brands.id, name: brands.name }).from(brands),
    ])
    const catByName = new Map(categoryRows.map((c) => [c.name.toLowerCase(), c.id]))
    const brandByName = new Map(brandRows.map((b) => [b.name.toLowerCase(), b.id]))
    const result: ImportResult = { created: 0, skipped: [], createdCategories: 0, createdBrands: 0 }

    const ensure = async (kind: 'category' | 'brand', name: string | undefined): Promise<ID | undefined> => {
      if (!name) return undefined
      const map = kind === 'category' ? catByName : brandByName
      const found = map.get(name.toLowerCase())
      if (found) return found
      const values = { name, status: 'active' as const, createdAt: now, updatedAt: now }
      const [row] = kind === 'category' ? await tx.insert(categories).values(values).returning() : await tx.insert(brands).values(values).returning()
      if (kind === 'category') result.createdCategories++
      else result.createdBrands++
      await writeAudit(tx, actor, { action: `${kind}.create`, module: 'catalog', entityId: row.id, after: row, reason: 'CSV import' })
      map.set(name.toLowerCase(), row.id)
      return row.id
    }

    for (const item of parsed.products) {
      const sku = item.data.sku ? normalizeSku(item.data.sku) : ''
      if (sku) {
        const [exists] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, sku))
        if (exists) {
          result.skipped.push({ line: item.line, sku, name: item.data.name })
          continue
        }
      }
      const product = await insertProduct(tx, actor, {
        ...item.data,
        categoryId: await ensure('category', item.category),
        brandId: await ensure('brand', item.brand),
      })
      if (item.status === 'archived') await tx.update(products).set({ status: 'archived' }).where(eq(products.id, product.id))
      result.created++
    }
    await writeAudit(tx, actor, { action: 'product.import', module: 'products', after: { created: result.created, skipped: result.skipped.length } })
    return result
  })
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = map.get(k)
    if (list) list.push(it)
    else map.set(k, [it])
  }
  return map
}
