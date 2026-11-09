import { z } from 'zod'
import type { BaseQty, DateOnly, ID, Money, ProductBatch, StockMovementType } from '@/types/db'
import { allocate, multiplyMoney } from './money'
import { MAX_MONEY } from './product'

/**
 * Inventory and purchase validation and arithmetic shared by the forms (browser) and the API (server).
 * Quantities are typed by the user as decimal strings in a chosen unit; the server converts them to
 * integer base units with the unit engine (src/lib/units.ts).
 */

const money = z.number().int('v.priceWholePoisha').min(0, 'v.amountNegative').max(MAX_MONEY, 'v.priceTooLarge')
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'v.invalidDate')
const quantity = z.string().trim().min(1, 'v.invalidQuantity')
const optionalText = (max: number) => z.string().trim().max(max).optional().default('')

// ---------------------------------------------------------------- stock adjustments

export const INCREASE_TYPES = ['opening', 'adjustment_increase'] as const
export const DECREASE_TYPES = ['adjustment_decrease', 'damaged', 'lost', 'expired'] as const
export const ADJUSTMENT_TYPES = [...INCREASE_TYPES, ...DECREASE_TYPES] as const
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]
export const isIncrease = (t: StockMovementType) => (INCREASE_TYPES as readonly string[]).includes(t)

export const adjustmentSchema = z
  .object({
    productId: z.string().uuid('v.selectProductOne'),
    type: z.enum(ADJUSTMENT_TYPES),
    unitId: z.string().uuid(),
    quantity,
    /** Cost per one of the chosen unit, for stock coming in. Decreases use the average cost. */
    unitCost: money.optional(),
    batchNo: optionalText(40),
    expiryDate: dateOnly.optional(),
    /** Take a decrease from this batch instead of FEFO order. */
    batchId: z.string().uuid().optional(),
    reason: optionalText(300),
  })
  .superRefine((a, ctx) => {
    // Opening stock explains itself; every other correction needs a written reason.
    if (a.type !== 'opening' && !a.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'v.reasonRequired' })
  })
export type AdjustmentInput = z.input<typeof adjustmentSchema>

// ---------------------------------------------------------------- suppliers

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'v.nameRequired').max(120, 'v.nameTooLong'),
  companyName: optionalText(120),
  phone: optionalText(30),
  address: optionalText(300),
  openingBalance: money.optional().default(0),
})
export type SupplierInput = z.input<typeof supplierSchema>

// ---------------------------------------------------------------- purchases

export const purchaseItemSchema = z.object({
  productId: z.string().uuid('v.selectProductOne'),
  unitId: z.string().uuid(),
  quantity,
  /** Cost per one purchase unit (per Sack, per Packet...). */
  unitCost: money,
  batchNo: optionalText(40),
  expiryDate: dateOnly.optional(),
})
export type PurchaseItemInput = z.input<typeof purchaseItemSchema>

export const purchaseInputSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(100),
    supplierId: z.string().uuid().optional(),
    referenceNo: optionalText(60),
    purchaseDate: dateOnly,
    items: z.array(purchaseItemSchema).min(1, 'v.addOneItem').max(300, 'v.tooManyItems'),
    discount: money.default(0),
    additionalCost: money.default(0),
    paid: money.default(0),
    note: optionalText(500),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>()
    p.items.forEach((it, i) => {
      // The same product and unit twice is almost always a mistake; batches make the exception.
      const key = `${it.productId}|${it.unitId}|${it.batchNo}|${it.expiryDate ?? ''}`
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['items', i, 'productId'], message: 'v.itemTwice' })
      seen.add(key)
    })
  })
export type PurchaseInput = z.input<typeof purchaseInputSchema>

export const cancelSchema = z.object({ reason: z.string().trim().min(1, 'v.reasonRequired').max(300) })

export interface PurchaseTotals {
  /** quantity × unit cost per line, before discount and additional cost. */
  amounts: Money[]
  /** Landed cost per line: amount − its share of the discount + its share of the additional cost. */
  landed: Money[]
  subtotal: Money
  total: Money
  due: Money
}

/**
 * Totals of a purchase. The invoice discount and additional cost (transport, labour) are spread over
 * the lines in proportion to their amounts, so each line's landed cost adds up exactly to the total.
 * Throws when an amount cannot be computed (invalid quantity) — callers validate quantities first.
 */
export function purchaseTotals(lines: ReadonlyArray<{ quantity: string; unitCost: Money }>, discount: Money, additionalCost: Money, paid: Money): PurchaseTotals {
  const amounts = lines.map((l) => multiplyMoney(l.unitCost, l.quantity))
  const subtotal = amounts.reduce((a, b) => a + b, 0)
  const discounts = allocate(Math.min(discount, subtotal), amounts)
  const extras = allocate(additionalCost, amounts)
  const landed = amounts.map((a, i) => a - discounts[i] + extras[i])
  const total = subtotal - Math.min(discount, subtotal) + additionalCost
  return { amounts, landed, subtotal, total, due: Math.max(0, total - paid) }
}

// ---------------------------------------------------------------- responses

export interface Supplier {
  id: ID
  name: string
  companyName?: string
  phone?: string
  address?: string
  openingBalance: Money
  balance: Money
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export interface PurchaseSummary {
  id: ID
  purchaseNo: string
  supplierId?: ID
  supplierName: string
  referenceNo?: string
  purchaseDate: DateOnly
  status: 'completed' | 'partially_returned' | 'returned' | 'cancelled'
  subtotal: Money
  discount: Money
  additionalCost: Money
  total: Money
  paid: Money
  due: Money
  itemCount: number
  userName: string
  note?: string
  cancelledAt?: number
  cancelReason?: string
  createdAt: number
}

export interface PurchaseLine {
  id: ID
  productId: ID
  productName: string
  sku: string
  unitName: string
  unitFactor: number
  quantity: string
  baseQty: BaseQty
  baseUnitName: string
  unitCost: Money
  amount: Money
  lineTotal: Money
  batchNo?: string
  expiryDate?: DateOnly
}

export interface PurchaseDetail extends PurchaseSummary {
  items: PurchaseLine[]
}

export interface MovementRow {
  id: ID
  productId: ID
  productName: string
  baseUnitName: string
  batchNo?: string
  type: StockMovementType
  qtyChange: BaseQty
  valueChange: Money
  balanceAfter: BaseQty
  refType?: string
  refId?: string
  reason?: string
  userName: string
  createdAt: number
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface BatchRow extends ProductBatch {
  productName: string
  sku: string
  baseUnitName: string
  /** Cost of what is left: costTotal × remaining / received. */
  remainingValue: Money
}

/** Expiry state of a batch on a given day. */
export function expiryState(expiryDate: DateOnly, today: DateOnly, warningDays: number, addDays: (d: DateOnly, n: number) => DateOnly): 'none' | 'expired' | 'soon' | 'ok' {
  if (expiryDate === '9999-12-31') return 'none'
  if (expiryDate < today) return 'expired'
  if (expiryDate <= addDays(today, warningDays)) return 'soon'
  return 'ok'
}
