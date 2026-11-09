import { z } from 'zod'
import type { Brand, Category, Money, Product, ProductBarcode, ProductUnit, StockMovement } from '@/types/db'
import { divRound } from './decimal'
import { isValidFactor, MAX_FACTOR } from './units'

/**
 * Product input validation and helpers shared by the product form (browser) and the
 * product API (server). The server always re-validates with the same schema.
 */

export const MAX_MONEY = 100_000_000_000 // ৳1,000,000,000.00 per unit is far beyond any real price
const money = z.number().int('Price must be in whole poisha').min(0, 'Price cannot be negative').max(MAX_MONEY, 'Price is too large')

export const productUnitSchema = z.object({
  /** Client-generated UUID, so barcodes and "contains N × unit" rows can refer to unsaved units. */
  id: z.string().uuid(),
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
  unitId: z.string().uuid().optional(),
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
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
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

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase()
}

// ---------------------------------------------------------------- API shapes

export interface ProductDetail {
  product: Product
  units: ProductUnit[]
  barcodes: ProductBarcode[]
  category?: Category
  brand?: Brand
  /** True when the product has stock or any history; its base unit is then locked and it can only be archived. */
  hasHistory: boolean
  recentMovements: StockMovement[]
}

/** Everything the product list, barcode page and pickers need, in one response. */
export interface CatalogSnapshot {
  products: Product[]
  units: ProductUnit[]
  barcodes: ProductBarcode[]
  categories: Category[]
  brands: Brand[]
}

/** Convert a stored product back into editable input (round-trips through the update API). */
export function detailToInput(d: Pick<ProductDetail, 'product' | 'units' | 'barcodes'>): ProductInput {
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
      isBase: u.isBase,
      canPurchase: u.canPurchase,
      canSell: u.canSell,
      retailPrice: u.retailPrice,
      wholesalePrice: u.wholesalePrice,
      purchasePrice: u.purchasePrice,
    })),
    barcodes: d.barcodes.map((b) => ({ code: b.code, unitId: b.unitId })),
  }
}

// ---------------------------------------------------------------- bulk price update

export type PriceField = 'retailPrice' | 'wholesalePrice' | 'purchasePrice'

export const bulkPriceSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1, 'Select at least one product.').max(5000),
  field: z.enum(['retailPrice', 'wholesalePrice', 'purchasePrice']),
  /** 'base' = only the base unit; 'all' = every unit of each product. */
  scope: z.enum(['base', 'all']),
  /** percent: value in basis points (+500 = +5%); amount: value in poisha per unit. Negative lowers prices. */
  method: z.enum(['percent', 'amount']),
  value: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Enter a non-zero change.'),
  /** Round results to whole taka (100 poisha) or keep poisha. */
  roundTo: z.union([z.literal(1), z.literal(100)]),
  reason: z.string().trim().max(200).optional(),
})
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>

export function adjustPrice(price: Money, method: BulkPriceInput['method'], value: number, roundTo: 1 | 100): Money {
  const raw = method === 'percent' ? price + divRound(BigInt(price) * BigInt(value), 10000n) : price + value
  return roundTo === 1 ? raw : divRound(raw, roundTo) * roundTo
}

