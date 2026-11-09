import { z } from 'zod'
import type { BaseQty, BasisPoints, ID, Money, PaymentMethod, PriceMode } from '@/types/db'
import { allocate, inclusiveTax, multiplyMoney, percentOf } from './money'
import { MAX_MONEY } from './product'

/**
 * Sale validation and arithmetic shared by the POS (browser) and the sales API (server). The server
 * recomputes every total from these functions; the browser uses them only to show the same numbers.
 */

export const PAYMENT_METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'other'] as const satisfies readonly PaymentMethod[]

const money = z.number().int('v.priceWholePoisha').min(0, 'v.amountNegative').max(MAX_MONEY, 'v.priceTooLarge')
const optionalText = (max: number) => z.string().trim().max(max).optional().default('')

export const saleItemSchema = z.object({
  productId: z.string().uuid('v.selectProductOne'),
  unitId: z.string().uuid(),
  quantity: z.string().trim().min(1, 'v.invalidQuantity'),
  /** Price per one selling unit. Must match the stored price unless the user may change prices. */
  unitPrice: money,
  discount: money.default(0),
})
export type SaleItemInput = z.input<typeof saleItemSchema>

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  /** Amount handed over. Only cash may be more than what is owed (the rest is change). */
  amount: money,
  reference: optionalText(60),
})
export type PaymentInput = z.input<typeof paymentSchema>

export const saleInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  customerId: z.string().uuid().optional(),
  priceMode: z.enum(['retail', 'wholesale']),
  items: z.array(saleItemSchema).min(1, 'v.addOneItem').max(300, 'v.tooManyItems'),
  invoiceDiscount: money.default(0),
  payments: z.array(paymentSchema).max(10).default([]),
  note: optionalText(300),
})
export type SaleInput = z.input<typeof saleInputSchema>

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'v.nameRequired').max(120, 'v.nameTooLong'),
  phone: optionalText(30),
  address: optionalText(300),
  openingBalance: money.optional().default(0),
  priceMode: z.enum(['retail', 'wholesale']).optional(),
})
export type CustomerInput = z.input<typeof customerSchema>

export const holdSchema = z.object({
  label: z.string().trim().min(1).max(60),
  cart: z.unknown(),
})

// ---------------------------------------------------------------- arithmetic

export interface SaleLineCalc {
  amount: Money
  discount: Money
  invoiceDiscount: Money
  tax: Money
  lineTotal: Money
}

export interface SaleCalc {
  lines: SaleLineCalc[]
  subtotal: Money
  itemDiscountTotal: Money
  invoiceDiscount: Money
  taxTotal: Money
  total: Money
}

/**
 * Totals of a sale.
 * 1. amount = price × quantity; the line discount comes off (never below zero).
 * 2. The invoice discount is spread over the lines in proportion to what is left (exact to the poisha).
 * 3. Tax per line on the discounted amount: contained in it when prices include tax, added on top otherwise.
 */
export function computeSale(
  lines: ReadonlyArray<{ quantity: string; unitPrice: Money; discount: Money; taxRate: BasisPoints }>,
  invoiceDiscount: Money,
  pricesIncludeTax: boolean,
): SaleCalc {
  const amounts = lines.map((l) => multiplyMoney(l.unitPrice, l.quantity))
  const discounts = lines.map((l, i) => Math.min(l.discount, amounts[i]))
  const nets = amounts.map((a, i) => a - discounts[i])
  const netTotal = nets.reduce((s, n) => s + n, 0)
  const invDisc = Math.min(invoiceDiscount, netTotal)
  const shares = allocate(invDisc, nets)
  const calc = lines.map((l, i): SaleLineCalc => {
    const after = nets[i] - shares[i]
    const tax = pricesIncludeTax ? inclusiveTax(after, l.taxRate) : percentOf(after, l.taxRate)
    return { amount: amounts[i], discount: discounts[i], invoiceDiscount: shares[i], tax, lineTotal: pricesIncludeTax ? after : after + tax }
  })
  const sum = (k: keyof SaleLineCalc) => calc.reduce((s, c) => s + c[k], 0)
  return {
    lines: calc,
    subtotal: sum('amount'),
    itemDiscountTotal: sum('discount'),
    invoiceDiscount: invDisc,
    taxTotal: sum('tax'),
    total: sum('lineTotal'),
  }
}

export interface Settlement {
  /** Kept per payment row (cash after change). */
  kept: Money[]
  paid: Money
  change: Money
  due: Money
  /** Non-cash payments add up to more than the total (they cannot give change). */
  nonCashTooMuch: boolean
}

/** How payments settle a total: change only from cash, the rest is due. */
export function settle(total: Money, payments: ReadonlyArray<{ method: PaymentMethod; amount: Money }>): Settlement {
  const handed = payments.reduce((s, p) => s + p.amount, 0)
  const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0)
  const change = Math.max(0, handed - total)
  // Take the change back from the cash rows, last row first.
  const kept = payments.map((p) => p.amount)
  let rest = change
  for (let i = payments.length - 1; i >= 0 && rest > 0; i--) {
    if (payments[i].method !== 'cash') continue
    const take = Math.min(rest, kept[i])
    kept[i] -= take
    rest -= take
  }
  const paid = Math.min(handed, total)
  return { kept, paid, change, due: total - paid, nonCashTooMuch: nonCash > total }
}

/** Price of a unit in a price mode; wholesale falls back to retail when not set. */
export function unitPriceFor(unit: { retailPrice: Money; wholesalePrice: Money }, mode: PriceMode): Money {
  return mode === 'wholesale' && unit.wholesalePrice > 0 ? unit.wholesalePrice : unit.retailPrice
}

// ---------------------------------------------------------------- responses

export interface Customer {
  id: ID
  name: string
  phone?: string
  address?: string
  openingBalance: Money
  balance: Money
  priceMode?: PriceMode
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export type SaleStatus = 'completed' | 'partially_returned' | 'returned' | 'cancelled'

export interface SaleSummary {
  id: ID
  invoiceNo: string
  customerId?: ID
  customerName: string
  customerPhone?: string
  cashierName: string
  priceMode: PriceMode
  status: SaleStatus
  subtotal: Money
  itemDiscountTotal: Money
  invoiceDiscount: Money
  taxTotal: Money
  total: Money
  paid: Money
  due: Money
  changeGiven: Money
  /** 0 for roles that cannot see cost. */
  cogs: Money
  itemCount: number
  note?: string
  cancelledAt?: number
  cancelReason?: string
  createdAt: number
}

export interface SaleLine {
  id: ID
  productId: ID
  productName: string
  sku: string
  unitName: string
  unitFactor: number
  quantity: string
  baseQty: BaseQty
  unitPrice: Money
  amount: Money
  discount: Money
  invoiceDiscount: Money
  taxRate: BasisPoints
  tax: Money
  lineTotal: Money
  costTotal: Money
}

export interface SalePayment {
  id: ID
  method: PaymentMethod
  amount: Money
  tendered: Money
  reference?: string
}

export interface SaleDetail extends SaleSummary {
  items: SaleLine[]
  payments: SalePayment[]
}

export interface HeldSale {
  id: ID
  label: string
  userName: string
  cart: unknown
  createdAt: number
}
