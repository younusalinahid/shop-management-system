import { z } from 'zod'
import type { DateOnly, ID, Money, PaymentMethod } from '@/types/db'
import { MAX_MONEY } from './product'
import { PAYMENT_METHODS } from './sales'

/** Cash, expenses, shifts and profit: validation and response types shared by the pages and the API. */

const amount = z.number().int('v.priceWholePoisha').min(1, 'v.amountPositive').max(MAX_MONEY, 'v.priceTooLarge')
const cash = z.number().int('v.priceWholePoisha').min(0, 'v.amountNegative').max(MAX_MONEY, 'v.priceTooLarge')
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'v.invalidDate')

/** Suggested categories; any text is allowed. */
export const EXPENSE_CATEGORIES = ['rent', 'salary', 'electricity', 'internet', 'transport', 'maintenance', 'tea_snacks', 'other'] as const

export const expenseSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  category: z.string().trim().min(1, 'v.required').max(60),
  amount,
  method: z.enum(PAYMENT_METHODS),
  expenseDate: dateOnly,
  description: z.string().trim().max(300).optional().default(''),
})
export type ExpenseInput = z.input<typeof expenseSchema>

export const cashMovementSchema = z.object({
  type: z.enum(['cash_in', 'cash_out']),
  amount,
  reason: z.string().trim().min(1, 'v.reasonRequired').max(200),
})
export type CashMovementInput = z.input<typeof cashMovementSchema>

export const openShiftSchema = z.object({ openingCash: cash })
export const closeShiftSchema = z.object({ countedCash: cash, note: z.string().trim().max(300).optional().default('') })

export interface ExpenseRecord {
  id: ID
  expenseNo: string
  category: string
  amount: Money
  method: PaymentMethod
  expenseDate: DateOnly
  description?: string
  status: 'active' | 'void'
  voidReason?: string
  userName: string
  createdAt: number
}

export type CashEventKind =
  | 'sale'
  | 'sale_cancel'
  | 'due_collection'
  | 'supplier_payment'
  | 'purchase'
  | 'purchase_cancel'
  | 'sale_refund'
  | 'purchase_refund'
  | 'expense'
  | 'cash_in'
  | 'cash_out'

/** One movement of money, from whichever document caused it. */
export interface CashEvent {
  at: number
  kind: CashEventKind
  direction: 'in' | 'out'
  method: PaymentMethod
  amount: Money
  ref?: string
  refId?: ID
  userId: string
  userName: string
  note?: string
}

export interface MethodTotals {
  method: PaymentMethod
  in: Money
  out: Money
}

export interface CashBook {
  events: CashEvent[]
  byMethod: MethodTotals[]
  /** Net cash (method "cash") over all time, from the records. */
  cashInDrawer: Money
}

export interface ShiftRecord {
  id: ID
  userId: string
  userName: string
  status: 'open' | 'closed'
  openedAt: number
  openingCash: Money
  closedAt?: number
  /** For an open shift: what the drawer should hold now. */
  expectedCash: Money
  countedCash?: Money
  difference?: Money
  note?: string
  /** Cash in / out during the shift, by kind. */
  cashIn: Money
  cashOut: Money
  salesCount: number
  salesTotal: Money
}

export interface ProfitAndLoss {
  from: DateOnly
  to: DateOnly
  /** Sales total without VAT, cancelled sales excluded. */
  sales: Money
  vat: Money
  salesCount: number
  returns: Money
  netSales: Money
  costOfGoods: Money
  grossProfit: Money
  /** Damaged, lost, expired and counting corrections (value of stock lost, net). */
  stockLoss: Money
  expenses: Money
  expensesByCategory: Array<{ category: string; amount: Money }>
  netProfit: Money
}
