import { z } from 'zod'
import type { BaseQty, ID, Money, PaymentMethod } from '@/types/db'
import { MAX_MONEY } from './product'
import { PAYMENT_METHODS } from './sales'

/**
 * Dues, payments and returns: validation and response types shared by the pages and the API.
 */

const amount = z.number().int('v.priceWholePoisha').min(1, 'v.amountPositive').max(MAX_MONEY, 'v.priceTooLarge')
const optionalText = (max: number) => z.string().trim().max(max).optional().default('')
const reason = z.string().trim().min(1, 'v.reasonRequired').max(300)

export const partyPaymentSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  partyId: z.string().uuid(),
  amount,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(60),
  note: optionalText(300),
})
export type PartyPaymentInput = z.input<typeof partyPaymentSchema>

export const voidSchema = z.object({ reason })

export const saleReturnSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  saleId: z.string().uuid(),
  items: z
    .array(
      z.object({
        saleItemId: z.string().uuid(),
        /** In the unit the item was sold in. */
        quantity: z.string().trim().min(1, 'v.invalidQuantity'),
        condition: z.enum(['resalable', 'damaged']),
      }),
    )
    .min(1, 'v.addOneItem'),
  refundMethod: z.enum(PAYMENT_METHODS).default('cash'),
  reason,
})
export type SaleReturnInput = z.input<typeof saleReturnSchema>

export const purchaseReturnSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  purchaseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.string().uuid(),
        quantity: z.string().trim().min(1, 'v.invalidQuantity'),
      }),
    )
    .min(1, 'v.addOneItem'),
  refundMethod: z.enum(PAYMENT_METHODS).default('cash'),
  reason,
})
export type PurchaseReturnInput = z.input<typeof purchaseReturnSchema>

// ---------------------------------------------------------------- responses

export type PaymentKind = 'due_collection' | 'supplier_payment' | 'customer_refund' | 'supplier_refund'

export interface PaymentRecord {
  id: ID
  paymentNo: string
  partyType: 'customer' | 'supplier'
  partyId: ID
  partyName: string
  kind: PaymentKind
  direction: 'in' | 'out'
  method: PaymentMethod
  amount: Money
  reference?: string
  note?: string
  refType?: string
  refId?: ID
  userName: string
  voidedAt?: number
  voidReason?: string
  createdAt: number
}

export type LedgerKind = 'opening' | 'sale' | 'purchase' | 'payment' | 'sale_return' | 'purchase_return'

/**
 * One line of a customer's or supplier's account. `change` is signed: + increases what they owe
 * (customer) or what the shop owes (supplier). `balance` is the running balance after this line.
 */
export interface LedgerEntry {
  kind: LedgerKind
  date: number
  ref?: string
  refId?: ID
  description?: string
  /** Document total, for context. */
  amount?: Money
  change: Money
  balance: Money
}

export interface ReturnLineView {
  itemId: ID
  productId: ID
  productName: string
  unitName: string
  unitFactor: number
  quantity: string
  baseQty: BaseQty
  returnedBaseQty: BaseQty
  lineTotal: Money
  allowFraction: boolean
}

export interface SaleReturnRecord {
  id: ID
  returnNo: string
  saleId: ID
  invoiceNo: string
  customerName: string
  total: Money
  dueAdjusted: Money
  refund: Money
  refundMethod?: PaymentMethod
  reason: string
  userName: string
  createdAt: number
  items: Array<{ id: ID; productName: string; unitName: string; quantity: string; amount: Money; condition: 'resalable' | 'damaged' }>
}

export interface PurchaseReturnRecord {
  id: ID
  returnNo: string
  purchaseId: ID
  purchaseNo: string
  supplierName: string
  total: Money
  payableAdjusted: Money
  refundReceived: Money
  refundMethod?: PaymentMethod
  reason: string
  userName: string
  createdAt: number
  items: Array<{ id: ID; productName: string; unitName: string; quantity: string; amount: Money }>
}
