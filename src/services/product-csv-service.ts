import { db } from '@/db/database'
import type { Brand, Category, ID, Product } from '@/types/db'
import { csvToObjects, toCsv } from '@/lib/csv'
import { integerToDecimalString, mulToInteger, parseDecimal } from '@/lib/decimal'
import { newId } from '@/lib/id'
import { moneyToInput, parseMoney } from '@/lib/money'
import { type Actor, writeAudit } from './audit-service'
import { requirePermission } from './permission-service'
import { insertProduct, normalizeSku, PRODUCT_TABLES, productInputSchema, type ProductData, type ProductInput } from './product-service'

/**
 * Product CSV: ONE ROW PER UNIT. Rows sharing a SKU form one product; product-level columns
 * are read from the base-unit row. Barcodes on a non-base row are bound to that unit, so
 * scanning a carton barcode selects "Carton" at the POS.
 *
 *   sku,name,...,unit,factor,is_base,...,retail_price,wholesale_price,purchase_price,barcodes
 *   CHOC1,1 Taka Chocolate,...,Piece,1,yes,...,1,0.9,0.8,
 *   CHOC1,1 Taka Chocolate,...,Packet,35,no,...,33,30,27,2000000000015
 */

export const PRODUCT_CSV_COLUMNS = [
  'sku',
  'name',
  'category',
  'brand',
  'description',
  'allow_fraction',
  'tax_rate',
  'min_stock',
  'track_batches',
  'track_expiry',
  'status',
  'unit',
  'symbol',
  'factor',
  'is_base',
  'can_purchase',
  'can_sell',
  'retail_price',
  'wholesale_price',
  'purchase_price',
  'barcodes',
] as const

const yesNo = (b: boolean) => (b ? 'yes' : 'no')

/** Export every product (or the given ids). Purchase prices are blank unless includeCost. */
export async function exportProductsCsv(opts: { includeCost: boolean; productIds?: ID[] }): Promise<string> {
  const products = opts.productIds ? (await db.products.bulkGet(opts.productIds)).filter((p): p is Product => !!p) : await db.products.orderBy('name').toArray()
  const [units, barcodes, categories, brands] = await Promise.all([
    db.productUnits.toArray(),
    db.productBarcodes.toArray(),
    db.categories.toArray(),
    db.brands.toArray(),
  ])
  const unitsBy = groupBy(units, (u) => u.productId)
  const codesBy = groupBy(barcodes, (b) => `${b.productId}|${b.unitId ?? ''}`)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const brandName = new Map(brands.map((b) => [b.id, b.name]))

  const rows: unknown[][] = [[...PRODUCT_CSV_COLUMNS]]
  for (const p of products) {
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
        opts.includeCost ? moneyToInput(u.purchasePrice) : '',
        codes.map((c) => c.code).join('|'),
      ])
    }
  }
  return toCsv(rows)
}

/** A blank template with the chocolate and rice examples, for users preparing an import. */
export function productCsvTemplate(): string {
  return toCsv([
    [...PRODUCT_CSV_COLUMNS],
    ['CHOC1', '1 Taka Chocolate', 'Confectionery', '', '', 'no', '0', '70', 'no', 'no', 'active', 'Piece', 'pc', '1', 'yes', 'no', 'yes', '1', '0.9', '0.8', ''],
    ['CHOC1', '1 Taka Chocolate', 'Confectionery', '', '', 'no', '0', '70', 'no', 'no', 'active', 'Packet', 'pkt', '35', 'no', 'yes', 'yes', '33', '30', '27', ''],
    ['RICE-MINIKET', 'Miniket Rice', 'Rice', '', '', 'yes', '0', '25000', 'no', 'no', 'active', 'Gram', 'g', '1', 'yes', 'no', 'yes', '0.08', '0.08', '0.07', ''],
    ['RICE-MINIKET', 'Miniket Rice', 'Rice', '', '', 'yes', '0', '25000', 'no', 'no', 'active', 'KG', 'kg', '1000', 'no', 'no', 'yes', '78', '74', '0', ''],
    ['RICE-MINIKET', 'Miniket Rice', 'Rice', '', '', 'yes', '0', '25000', 'no', 'no', 'active', 'Sack', 'sack', '25000', 'no', 'yes', 'yes', '1900', '1825', '1750', ''],
  ])
}

// ---------------------------------------------------------------- import

export interface CsvIssue {
  line: number
  message: string
}

export interface ParsedImport {
  /** Products ready to insert, with category/brand still as names. */
  products: Array<{ line: number; data: ProductData; category?: string; brand?: string; status: 'active' | 'archived' }>
  errors: CsvIssue[]
}

function parseBool(v: string, line: number, col: string, errors: CsvIssue[], fallback: boolean): boolean {
  const s = v.trim().toLowerCase()
  if (s === '') return fallback
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  errors.push({ line, message: `${col}: expected yes or no, got "${v}"` })
  return fallback
}

function parseMoneyCell(v: string, line: number, col: string, errors: CsvIssue[]): number {
  if (v.trim() === '') return 0
  try {
    const m = parseMoney(v)
    if (m < 0) throw new Error()
    return m
  } catch {
    errors.push({ line, message: `${col}: "${v}" is not a valid amount (max 2 decimals)` })
    return 0
  }
}

/** Validate the whole file without writing anything. */
export function parseProductCsv(text: string): ParsedImport {
  const errors: CsvIssue[] = []
  let rows
  try {
    rows = csvToObjects(text)
  } catch (e) {
    return { products: [], errors: [{ line: 0, message: e instanceof Error ? e.message : 'Unreadable CSV' }] }
  }
  if (rows.length === 0) return { products: [], errors: [{ line: 0, message: 'The file has no data rows.' }] }
  const header = Object.keys(rows[0].values)
  for (const col of ['name', 'unit', 'factor', 'is_base']) {
    if (!header.includes(col)) errors.push({ line: 1, message: `Missing required column "${col}"` })
  }
  if (errors.length) return { products: [], errors }

  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.values.sku ? `sku:${normalizeSku(r.values.sku)}` : `name:${r.values.name.toLowerCase()}`
    if (!r.values.sku && !r.values.name) {
      errors.push({ line: r.line, message: 'Each row needs a sku or a name' })
      continue
    }
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const products: ParsedImport['products'] = []
  const seenCodes = new Map<string, number>()
  for (const group of groups.values()) {
    const head = group.find((r) => parseBool(r.values.is_base ?? '', r.line, 'is_base', [], false)) ?? group[0]
    const v = head.values
    const line = head.line
    const rowErrors: CsvIssue[] = []

    let taxRate = 0
    try {
      const d = parseDecimal(v.tax_rate || '0')
      if (d.scale > 2 || d.units < 0n) throw new Error()
      taxRate = mulToInteger(d, 100, 'exact')
    } catch {
      rowErrors.push({ line, message: `tax_rate: "${v.tax_rate}" is not a valid percentage` })
    }
    const minStock = Number(v.min_stock || '0')
    if (!Number.isSafeInteger(minStock) || minStock < 0) rowErrors.push({ line, message: 'min_stock: whole number in base units expected' })

    const units: ProductInput['units'] = []
    const barcodes: ProductInput['barcodes'] = []
    for (const r of group) {
      const u = r.values
      const factor = Number(u.factor)
      const id = newId()
      const isBase = parseBool(u.is_base, r.line, 'is_base', rowErrors, false)
      units.push({
        id,
        name: u.unit,
        symbol: u.symbol || undefined,
        factor,
        isBase,
        canPurchase: parseBool(u.can_purchase ?? '', r.line, 'can_purchase', rowErrors, true),
        canSell: parseBool(u.can_sell ?? '', r.line, 'can_sell', rowErrors, true),
        retailPrice: parseMoneyCell(u.retail_price ?? '', r.line, 'retail_price', rowErrors),
        wholesalePrice: parseMoneyCell(u.wholesale_price ?? '', r.line, 'wholesale_price', rowErrors),
        purchasePrice: parseMoneyCell(u.purchase_price ?? '', r.line, 'purchase_price', rowErrors),
      })
      for (const code of (u.barcodes ?? '').split('|').map((c) => c.trim()).filter(Boolean)) {
        const other = seenCodes.get(code)
        if (other !== undefined) rowErrors.push({ line: r.line, message: `Barcode ${code} also appears on line ${other}` })
        seenCodes.set(code, r.line)
        barcodes.push({ code, unitId: isBase ? undefined : id })
      }
    }

    const status = (v.status || 'active').toLowerCase()
    if (status !== 'active' && status !== 'archived') rowErrors.push({ line, message: 'status: active or archived expected' })

    const input: ProductInput = {
      name: v.name,
      sku: v.sku ?? '',
      description: v.description ?? '',
      allowFraction: parseBool(v.allow_fraction ?? '', line, 'allow_fraction', rowErrors, false),
      minStockQty: Number.isSafeInteger(minStock) && minStock >= 0 ? minStock : 0,
      taxRate,
      trackBatches: parseBool(v.track_batches ?? '', line, 'track_batches', rowErrors, false),
      trackExpiry: parseBool(v.track_expiry ?? '', line, 'track_expiry', rowErrors, false),
      units,
      barcodes,
    }
    const res = productInputSchema.safeParse(input)
    if (!res.success) {
      for (const issue of res.error.issues) rowErrors.push({ line, message: `${v.name || v.sku}: ${issue.message}` })
    }
    errors.push(...rowErrors)
    if (res.success && rowErrors.length === 0) {
      products.push({ line, data: res.data, category: v.category || undefined, brand: v.brand || undefined, status: status as 'active' | 'archived' })
    }
  }
  errors.sort((a, b) => a.line - b.line)
  return { products, errors }
}

export interface ImportResult {
  created: number
  skipped: Array<{ line: number; sku: string; name: string }>
  createdCategories: number
  createdBrands: number
}

/**
 * Import a parsed file atomically: either every new product is created or none is.
 * Products whose SKU already exists are skipped (never overwritten). Missing categories
 * and brands are created by name.
 */
export async function importProducts(actor: Actor, parsed: ParsedImport): Promise<ImportResult> {
  await requirePermission(actor, 'products.edit', 'products.edit_price')
  if (parsed.errors.length) throw new Error('Fix the errors in the file before importing.')
  const now = Date.now()

  return db.transaction('rw', PRODUCT_TABLES, async () => {
    const [categories, brands] = await Promise.all([db.categories.toArray(), db.brands.toArray()])
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]))
    const result: ImportResult = { created: 0, skipped: [], createdCategories: 0, createdBrands: 0 }

    const ensure = async (kind: 'category' | 'brand', name: string | undefined): Promise<ID | undefined> => {
      if (!name) return undefined
      const map = kind === 'category' ? catByName : brandByName
      const found = map.get(name.toLowerCase())
      if (found) return found
      const row: Category & Brand = { id: newId(), name, status: 'active', createdAt: now, updatedAt: now }
      if (kind === 'category') {
        await db.categories.add(row)
        result.createdCategories++
      } else {
        await db.brands.add(row)
        result.createdBrands++
      }
      await writeAudit(actor, { action: `${kind}.create`, module: 'catalog', entityId: row.id, after: row, reason: 'CSV import' })
      map.set(name.toLowerCase(), row.id)
      return row.id
    }

    for (const item of parsed.products) {
      const sku = item.data.sku ? normalizeSku(item.data.sku) : ''
      if (sku && (await db.products.where('sku').equals(sku).first())) {
        result.skipped.push({ line: item.line, sku, name: item.data.name })
        continue
      }
      const product = await insertProduct(actor, {
        ...item.data,
        categoryId: await ensure('category', item.category),
        brandId: await ensure('brand', item.brand),
      })
      if (item.status === 'archived') await db.products.update(product.id, { status: 'archived' })
      result.created++
    }
    await writeAudit(actor, { action: 'product.import', module: 'products', after: { created: result.created, skipped: result.skipped.length } })
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
