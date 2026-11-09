// @vitest-environment node
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import { computeSale, settle } from '@/lib/sales'
import { type Db, getDb } from '@/server/db'
import { customers, productBatches, products, sales, settings, stockMovements } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { adjustStock } from '@/server/services/inventory'
import { createProduct } from '@/server/services/product'
import { createPurchase } from '@/server/services/purchase'
import { cancelSale, createSale, holdSale, listHeld, listSales } from '@/server/services/sale'
import { createCustomer } from '@/server/services/customer'
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

/** Rice with 10 KG in stock at ৳70/KG. */
async function rice() {
  const units = [unit('Gram', 1, { canSell: false }), unit('KG', 1000, { retailPrice: 7800, wholesalePrice: 7400 }), unit('Sack', 25_000, { retailPrice: 190_000 })]
  const p = await createProduct(db, owner, { name: 'Miniket Rice', allowFraction: true, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units, barcodes: [] })
  await adjustStock(db, owner, { productId: p.id, type: 'opening', unitId: units[1].id, quantity: '10', unitCost: 7000 })
  return { p, kg: units[1], sack: units[2] }
}

const stockOf = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]
const sell = (actor: Actor, items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  createSale(db, actor, { idempotencyKey: newId(), priceMode: 'retail', items: items as never, payments: [], ...extra })

describe('sale arithmetic', () => {
  it('spreads the invoice discount and handles inclusive and exclusive tax', () => {
    const lines = [
      { quantity: '2', unitPrice: 100_00, discount: 10_00, taxRate: 0 },
      { quantity: '1', unitPrice: 110_00, discount: 0, taxRate: 1000 },
    ]
    const incl = computeSale(lines, 10_00, true)
    // ৳10 split by what is left on each line (৳190 and ৳110), exact to the poisha.
    expect(incl.lines.map((l) => l.invoiceDiscount)).toEqual([6_33, 3_67])
    expect(incl.lines[1]).toMatchObject({ lineTotal: 106_33, tax: 9_67 })
    expect(incl.total).toBe(290_00)

    const excl = computeSale(lines, 10_00, false)
    expect(excl.lines[1]).toMatchObject({ tax: 10_63, lineTotal: 116_96 })
    expect(excl.total).toBe(183_67 + 116_96)
  })

  it('gives change only from cash', () => {
    expect(settle(500_00, [{ method: 'bkash', amount: 200_00 }, { method: 'cash', amount: 500_00 }])).toMatchObject({ kept: [200_00, 300_00], paid: 500_00, change: 200_00, due: 0 })
    expect(settle(500_00, [{ method: 'cash', amount: 100_00 }])).toMatchObject({ paid: 100_00, due: 400_00, change: 0 })
    expect(settle(500_00, [{ method: 'card', amount: 600_00 }]).nonCashTooMuch).toBe(true)
  })
})

describe('sales', () => {
  it('sells 1.5 KG of rice: stock, cost of goods, change and invoice number', async () => {
    const { p, kg } = await rice()
    const s = await sell(cashier, [{ productId: p.id, unitId: kg.id, quantity: '1.5', unitPrice: 7800 }], { payments: [{ method: 'cash', amount: 200_00 }] })
    expect(s).toMatchObject({ invoiceNo: 'INV-000001', total: 117_00, paid: 117_00, changeGiven: 83_00, due: 0, cogs: 105_00, cashierName: 'Rafi' })
    expect(s.items[0]).toMatchObject({ baseQty: 1500, unitName: 'KG', lineTotal: 117_00, costTotal: 105_00 })
    expect(s.payments[0]).toMatchObject({ method: 'cash', tendered: 200_00, amount: 117_00 })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 8500, stockValue: 595_00 })
  })

  it('refuses to oversell and saves nothing; allows it when the setting is on', async () => {
    const { p, kg, sack } = await rice()
    await expect(sell(owner, [{ productId: p.id, unitId: kg.id, quantity: '1', unitPrice: 7800 }, { productId: p.id, unitId: sack.id, quantity: '1', unitPrice: 190_000 }], { payments: [{ method: 'cash', amount: 2_000_00 }] })).rejects.toMatchObject({ code: 'insufficient_stock' })
    expect((await stockOf(p.id)).stockQty).toBe(10_000)
    expect(await db.select().from(sales)).toHaveLength(0)

    await db.insert(settings).values({ id: 'app', data: { allowNegativeStock: true }, updatedAt: Date.now() })
    await sell(owner, [{ productId: p.id, unitId: sack.id, quantity: '1', unitPrice: 190_000 }], { payments: [{ method: 'cash', amount: 190_000 }] })
    expect((await stockOf(p.id)).stockQty).toBe(-15_000)
  })

  it('protects prices, requires a customer for due, and records the customer due', async () => {
    const { p, kg } = await rice()
    await expect(sell(cashier, [{ productId: p.id, unitId: kg.id, quantity: '1', unitPrice: 5000 }])).rejects.toMatchObject({ code: 'forbidden' })
    await expect(sell(cashier, [{ productId: p.id, unitId: kg.id, quantity: '1', unitPrice: 7800 }])).rejects.toMatchObject({ code: 'due_needs_customer' })
    // Wholesale mode uses the wholesale price.
    const c = await createCustomer(db, cashier, { name: 'Hasan Store', phone: '01811111111' })
    const s = await sell(cashier, [{ productId: p.id, unitId: kg.id, quantity: '2', unitPrice: 7400 }], { priceMode: 'wholesale', customerId: c.id, payments: [{ method: 'bkash', amount: 48_00, reference: 'TX1' }] })
    expect(s).toMatchObject({ total: 148_00, paid: 48_00, due: 100_00, customerName: 'Hasan Store' })
    expect((await db.select().from(customers).where(eq(customers.id, c.id)))[0].balance).toBe(100_00)
  })

  it('cancels a sale: stock, batches, cost and customer due go back', async () => {
    const units = [unit('Piece', 1, { retailPrice: 30_00 }), unit('Carton', 12)]
    const milk = await createProduct(db, owner, { name: 'Milk', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: true, trackExpiry: true, units, barcodes: [] })
    const sup = await createSupplier(db, owner, { name: 'Dairy' })
    await createPurchase(db, owner, {
      idempotencyKey: newId(),
      supplierId: sup.id,
      purchaseDate: '2026-11-10',
      items: [
        { productId: milk.id, unitId: units[1].id, quantity: '1', unitCost: 240_00, batchNo: 'OLD', expiryDate: '2020-01-01' },
        { productId: milk.id, unitId: units[1].id, quantity: '1', unitCost: 300_00, batchNo: 'A', expiryDate: '2099-01-01' },
      ],
    })
    // The expired batch is skipped: only 12 pieces can be sold.
    await expect(sell(owner, [{ productId: milk.id, unitId: units[0].id, quantity: '13', unitPrice: 30_00 }], { payments: [{ method: 'cash', amount: 390_00 }] })).rejects.toMatchObject({ code: 'insufficient_stock' })

    const c = await createCustomer(db, owner, { name: 'Hasan' })
    const s = await sell(owner, [{ productId: milk.id, unitId: units[0].id, quantity: '5', unitPrice: 30_00 }], { customerId: c.id })
    // Weighted average over both batches: ৳540 / 24 pieces = ৳22.50 each.
    expect(s.cogs).toBe(112_50)
    const batch = async (no: string) => (await db.select().from(productBatches).where(eq(productBatches.batchNo, no)))[0]
    expect((await batch('A')).qtyRemaining).toBe(7)

    await expect(cancelSale(db, cashier, s.id, { reason: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    const cancelled = await cancelSale(db, owner, s.id, { reason: 'Customer changed mind' })
    expect(cancelled.status).toBe('cancelled')
    expect((await batch('A')).qtyRemaining).toBe(12)
    expect(await stockOf(milk.id)).toMatchObject({ stockQty: 24, stockValue: 540_00 })
    expect((await db.select().from(customers).where(eq(customers.id, c.id)))[0].balance).toBe(0)
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.productId, milk.id)).orderBy(asc(stockMovements.createdAt))
    expect(moves.at(-1)).toMatchObject({ type: 'sale_cancel', qtyChange: 5, valueChange: 112_50 })
    expect((await listSales(db, {})).totals).toMatchObject({ count: 0, total: 0 })
  })

  it('saves one sale for a repeated submission and keeps held carts', async () => {
    const { p, kg } = await rice()
    const input = { idempotencyKey: 'pos-click-1', priceMode: 'retail' as const, items: [{ productId: p.id, unitId: kg.id, quantity: '1', unitPrice: 7800 }], payments: [{ method: 'cash' as const, amount: 7800 }] }
    const [a, b] = await Promise.all([createSale(db, cashier, input), createSale(db, cashier, input)])
    expect(a.id).toBe(b.id)
    expect((await stockOf(p.id)).stockQty).toBe(9000)

    await holdSale(db, cashier, { label: 'Customer in blue', cart: { lines: [1, 2] } })
    expect(await listHeld(db)).toMatchObject([{ label: 'Customer in blue', userName: 'Rafi', cart: { lines: [1, 2] } }])
  })
})
