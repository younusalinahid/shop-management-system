// @vitest-environment node
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import { type Db, getDb } from '@/server/db'
import { customers, productBatches, products, sales, suppliers } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { createCustomer } from '@/server/services/customer'
import { createProduct } from '@/server/services/product'
import { collectDue, customerLedger, paySupplier, supplierLedger, voidPayment } from '@/server/services/payment'
import { createPurchase } from '@/server/services/purchase'
import { createPurchaseReturn, createSaleReturn, listSaleReturns } from '@/server/services/returns'
import { createSale } from '@/server/services/sale'
import { createSupplier } from '@/server/services/supplier'

let db: Db
let owner: Actor
const cashier: Actor = { id: 'cashier-1', name: 'Rafi', role: 'cashier' }

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
})

const unit = (name: string, factor: number, extra: Record<string, unknown> = {}) => ({
  id: newId(),
  name,
  factor,
  isBase: factor === 1,
  canPurchase: true,
  canSell: true,
  retailPrice: 0,
  wholesalePrice: 0,
  purchasePrice: 0,
  ...extra,
})

/** Soap: bought 20 pieces at ৳40 on credit from a supplier, sold at ৳50. */
async function setup() {
  const units = [unit('Piece', 1, { retailPrice: 50_00 }), unit('Box', 10)]
  const p = await createProduct(db, owner, { name: 'Soap', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: true, trackExpiry: false, units, barcodes: [] })
  const sup = await createSupplier(db, owner, { name: 'Unilever Dealer' })
  const purchase = await createPurchase(db, owner, { idempotencyKey: newId(), supplierId: sup.id, purchaseDate: '2026-11-10', items: [{ productId: p.id, unitId: units[1].id, quantity: '2', unitCost: 400_00 }] })
  const cust = await createCustomer(db, owner, { name: 'Hasan', phone: '01900000000' })
  return { p, piece: units[0], box: units[1], sup, purchase, cust }
}

const stockOf = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]
const balanceOf = async (table: typeof customers | typeof suppliers, id: string) => (await db.select({ b: table.balance }).from(table).where(eq(table.id, id)))[0].b

describe('dues and payments', () => {
  it('collects customer due, pays the supplier, voids a mistake, and the ledgers add up', async () => {
    const { p, piece, sup, cust } = await setup()
    await createSale(db, owner, { idempotencyKey: newId(), customerId: cust.id, priceMode: 'retail', items: [{ productId: p.id, unitId: piece.id, quantity: '4', unitPrice: 50_00 }], payments: [{ method: 'cash', amount: 50_00 }] })
    expect(await balanceOf(customers, cust.id)).toBe(150_00)

    await expect(collectDue(db, cashier, { idempotencyKey: newId(), partyId: cust.id, amount: 200_00, method: 'cash' })).rejects.toMatchObject({ code: 'overpaid' })
    const pay = await collectDue(db, cashier, { idempotencyKey: newId(), partyId: cust.id, amount: 100_00, method: 'bkash', reference: 'TX9' })
    expect(pay).toMatchObject({ paymentNo: 'PAY-000001', direction: 'in', kind: 'due_collection' })
    expect(await balanceOf(customers, cust.id)).toBe(50_00)

    await expect(voidPayment(db, cashier, pay.id, { reason: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    await voidPayment(db, owner, pay.id, { reason: 'Wrong customer' })
    expect(await balanceOf(customers, cust.id)).toBe(150_00)
    const ledger = await customerLedger(db, cust.id)
    expect(ledger.map((e) => [e.kind, e.change])).toEqual([['sale', 150_00]])
    expect(ledger.at(-1)!.balance).toBe(150_00)

    expect(await balanceOf(suppliers, sup.id)).toBe(800_00)
    await paySupplier(db, owner, { idempotencyKey: newId(), partyId: sup.id, amount: 300_00, method: 'cash' })
    const sl = await supplierLedger(db, sup.id)
    expect(sl.map((e) => [e.kind, e.change, e.balance])).toEqual([
      ['purchase', 800_00, 800_00],
      ['payment', -300_00, 500_00],
    ])
    expect(await balanceOf(suppliers, sup.id)).toBe(500_00)
  })
})

describe('sale returns', () => {
  it('restocks resalable items, not damaged ones, and settles the due before refunding', async () => {
    const { p, piece, cust } = await setup()
    const sale = await createSale(db, owner, { idempotencyKey: newId(), customerId: cust.id, priceMode: 'retail', items: [{ productId: p.id, unitId: piece.id, quantity: '6', unitPrice: 50_00 }], payments: [{ method: 'cash', amount: 200_00 }] })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 14, stockValue: 560_00 })
    const item = sale.items[0]

    // 3 back in good condition: stock and cost come back; ৳150 clears the ৳100 due and refunds ৳50.
    const r1 = await createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: item.id, quantity: '3', condition: 'resalable' }], reason: 'Wrong scent' })
    expect(r1).toMatchObject({ returnNo: 'SR-000001', total: 150_00, dueAdjusted: 100_00, refund: 50_00, refundMethod: 'cash' })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 17, stockValue: 680_00 })
    expect(await balanceOf(customers, cust.id)).toBe(0)
    expect((await db.select().from(productBatches).where(eq(productBatches.productId, p.id)))[0].qtyRemaining).toBe(17)

    // 2 damaged: money back, no stock.
    await createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: item.id, quantity: '2', condition: 'damaged' }], reason: 'Broken' })
    expect((await stockOf(p.id)).stockQty).toBe(17)
    // Only 1 piece left to return.
    await expect(createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: item.id, quantity: '2', condition: 'resalable' }], reason: 'x' })).rejects.toMatchObject({ code: 'return_too_much' })
    await expect(createSaleReturn(db, cashier, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: item.id, quantity: '1', condition: 'resalable' }], reason: 'x' })).rejects.toMatchObject({ code: 'forbidden' })

    const last = await createSaleReturn(db, owner, { idempotencyKey: newId(), saleId: sale.id, items: [{ saleItemId: item.id, quantity: '1', condition: 'resalable' }], reason: 'Last one' })
    expect(last.total).toBe(50_00)
    expect((await db.select().from(sales).where(eq(sales.id, sale.id)))[0].status).toBe('returned')
    expect((await listSaleReturns(db, { docId: sale.id })).totals.total).toBe(300_00)
  })
})

describe('purchase returns', () => {
  it('sends stock back from the purchase batch and reduces the supplier payable', async () => {
    const { p, box, sup, purchase } = await setup()
    const line = purchase.items[0]
    const r = await createPurchaseReturn(db, owner, { idempotencyKey: newId(), purchaseId: purchase.id, items: [{ purchaseItemId: line.id, quantity: '1' }], reason: 'Damaged box' })
    expect(r).toMatchObject({ returnNo: 'PR-000001', total: 400_00, payableAdjusted: 400_00, refundReceived: 0 })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 10, stockValue: 400_00 })
    expect(await balanceOf(suppliers, sup.id)).toBe(400_00)
    await expect(createPurchaseReturn(db, owner, { idempotencyKey: newId(), purchaseId: purchase.id, items: [{ purchaseItemId: line.id, quantity: '2' }], reason: 'x' })).rejects.toMatchObject({ code: 'return_too_much' })
    expect(box.name).toBe('Box')
  })
})
