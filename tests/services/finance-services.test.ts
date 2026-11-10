// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { todayDateOnly } from '@/lib/datetime'
import { newId } from '@/lib/id'
import { type Db, getDb } from '@/server/db'
import { settings } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { createCustomer } from '@/server/services/customer'
import { addCashMovement, cashBook, closeShift, createExpense, currentShift, listExpenses, openShift, profitAndLoss, voidExpense } from '@/server/services/finance'
import { adjustStock } from '@/server/services/inventory'
import { collectDue } from '@/server/services/payment'
import { createProduct } from '@/server/services/product'
import { createSaleReturn } from '@/server/services/returns'
import { createSale } from '@/server/services/sale'

let db: Db
let owner: Actor
const cashier: Actor = { id: 'cashier-1', name: 'Rafi', role: 'cashier' }
const today = todayDateOnly()

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
})

/** Pen: 100 in stock at ৳6, sold at ৳10. */
async function pen() {
  const piece = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 10_00, wholesalePrice: 0, purchasePrice: 6_00 }
  const p = await createProduct(db, owner, { name: 'Pen', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [piece], barcodes: [] })
  await adjustStock(db, owner, { productId: p.id, type: 'opening', unitId: piece.id, quantity: '100', unitCost: 6_00 })
  return { p, piece }
}

describe('expenses', () => {
  it('records, totals by category and voids', async () => {
    await expect(createExpense(db, cashier, { idempotencyKey: newId(), category: 'rent', amount: 5000_00, method: 'cash', expenseDate: today })).rejects.toMatchObject({ code: 'forbidden' })
    const rent = await createExpense(db, owner, { idempotencyKey: newId(), category: 'rent', amount: 5000_00, method: 'bank', expenseDate: today })
    await createExpense(db, owner, { idempotencyKey: newId(), category: 'tea_snacks', amount: 120_00, method: 'cash', expenseDate: today })
    expect(rent.expenseNo).toBe('EXP-000001')
    expect((await listExpenses(db, { from: today, to: today })).totals.total).toBe(5120_00)
    await voidExpense(db, owner, rent.id, 'Entered twice')
    const after = await listExpenses(db, {})
    expect(after.totals.byCategory).toEqual([{ category: 'tea_snacks', amount: 120_00 }])
    expect(after.items.find((e) => e.id === rent.id)?.status).toBe('void')
  })
})

describe('cash book and shifts', () => {
  it('builds the cash book from documents and checks the counted drawer', async () => {
    const { p, piece } = await pen()
    await db.insert(settings).values({ id: 'app', data: { requireShiftForSale: true }, updatedAt: Date.now() })
    const sellPens = (actor: Actor, qty: string, payments: Array<{ method: 'cash' | 'bkash'; amount: number }>, extra = {}) =>
      createSale(db, actor, { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: p.id, unitId: piece.id, quantity: qty, unitPrice: 10_00 }], payments, ...extra })

    await expect(sellPens(cashier, '1', [{ method: 'cash', amount: 10_00 }])).rejects.toMatchObject({ code: 'shift_required' })
    const shift = await openShift(db, cashier, { openingCash: 500_00 })
    await expect(openShift(db, owner, { openingCash: 0 })).rejects.toMatchObject({ code: 'conflict' })

    // ৳100 cash (with ৳20 change from ৳120), ৳50 bKash, a ৳30 due collected in cash, a ৳10 refund in cash.
    const s1 = await sellPens(cashier, '10', [{ method: 'cash', amount: 120_00 }])
    await sellPens(cashier, '5', [{ method: 'bkash', amount: 50_00 }])
    const c = await createCustomer(db, cashier, { name: 'Hasan' })
    await sellPens(cashier, '3', [], { customerId: c.id })
    await collectDue(db, cashier, { idempotencyKey: newId(), partyId: c.id, amount: 30_00, method: 'cash' })
    await createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: s1.id, items: [{ saleItemId: s1.items[0].id, quantity: '1', condition: 'resalable' }], reason: 'Broken nib' })
    await addCashMovement(db, owner, { type: 'cash_out', amount: 40_00, reason: 'Bank deposit' })

    const now = await currentShift(db, cashier.id)
    // Only the cashier's own cash counts for their shift: 500 + 100 + 30 = 630 (the refund and cash out were the owner's).
    expect(now).toMatchObject({ expectedCash: 630_00, cashIn: 130_00, salesCount: 3, salesTotal: 180_00 })

    const closed = await closeShift(db, cashier, shift.id, { countedCash: 620_00, note: 'Short' })
    expect(closed).toMatchObject({ status: 'closed', expectedCash: 630_00, countedCash: 620_00, difference: -10_00 })

    const book = await cashBook(db, today, today)
    expect(book.byMethod).toEqual([
      { method: 'cash', in: 130_00, out: 50_00 },
      { method: 'bkash', in: 50_00, out: 0 },
    ])
    expect(book.cashInDrawer).toBe(80_00)
    expect(book.events.map((e) => e.kind)).toContain('sale_refund')
  })
})

describe('profit and loss', () => {
  it('sales minus returns minus cost, stock loss and expenses', async () => {
    const { p, piece } = await pen()
    const sale = await createSale(db, owner, { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: p.id, unitId: piece.id, quantity: '20', unitPrice: 10_00 }], payments: [{ method: 'cash', amount: 200_00 }] })
    await createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: '2', condition: 'resalable' }], reason: 'x' })
    await adjustStock(db, owner, { productId: p.id, type: 'damaged', unitId: piece.id, quantity: '5', reason: 'Leaked' })
    await createExpense(db, owner, { idempotencyKey: newId(), category: 'electricity', amount: 25_00, method: 'cash', expenseDate: today })

    const pl = await profitAndLoss(db, today, today)
    expect(pl).toMatchObject({
      sales: 200_00,
      returns: 20_00,
      netSales: 180_00,
      costOfGoods: 108_00,
      grossProfit: 72_00,
      stockLoss: 30_00,
      expenses: 25_00,
      netProfit: 17_00,
    })
  })
})
