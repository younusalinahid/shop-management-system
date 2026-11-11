// @vitest-environment node
import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import { type Db, getDb } from '@/server/db'
import { auditLogs, customers, products, purchases, saleReturns, sales, stockMovements, suppliers } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { createCustomer } from '@/server/services/customer'
import { adjustStock } from '@/server/services/inventory'
import { createProduct } from '@/server/services/product'
import { createPurchase } from '@/server/services/purchase'
import { createSaleReturn } from '@/server/services/returns'
import { createSale } from '@/server/services/sale'
import { createSupplier } from '@/server/services/supplier'

/**
 * Transaction safety: a failure at any step leaves no trace (no stock change, no document, no balance
 * change, no audit row), and concurrent requests for the last units of stock cannot both succeed.
 */

let db: Db
let owner: Actor

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
})

async function product(name: string, stock: number) {
  const piece = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 10_00, wholesalePrice: 0, purchasePrice: 5_00 }
  const p = await createProduct(db, owner, { name, allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [piece], barcodes: [] })
  if (stock) await adjustStock(db, owner, { productId: p.id, type: 'opening', unitId: piece.id, quantity: String(stock), unitCost: 5_00 })
  return { p, piece }
}

/** Everything a failed operation could have touched. */
async function snapshot() {
  const [s] = await db.select({ n: count() }).from(sales)
  const [pu] = await db.select({ n: count() }).from(purchases)
  const [r] = await db.select({ n: count() }).from(saleReturns)
  const [m] = await db.select({ n: count() }).from(stockMovements)
  const [a] = await db.select({ n: count() }).from(auditLogs)
  const stock = await db.select({ id: products.id, q: products.stockQty, v: products.stockValue }).from(products)
  const bal = await db.select({ id: customers.id, b: customers.balance }).from(customers)
  const sup = await db.select({ id: suppliers.id, b: suppliers.balance }).from(suppliers)
  return { sales: s.n, purchases: pu.n, returns: r.n, movements: m.n, audits: a.n, stock, bal, sup }
}

describe('rollback', () => {
  it('a sale whose second line is short of stock leaves nothing behind', async () => {
    const a = await product('Pen', 10)
    const b = await product('Ink', 1)
    const c = await createCustomer(db, owner, { name: 'Hasan' })
    const before = await snapshot()
    await expect(
      createSale(db, owner, {
        idempotencyKey: newId(),
        customerId: c.id,
        priceMode: 'retail',
        items: [
          { productId: a.p.id, unitId: a.piece.id, quantity: '5', unitPrice: 10_00 },
          { productId: b.p.id, unitId: b.piece.id, quantity: '2', unitPrice: 10_00 },
        ],
        payments: [],
      }),
    ).rejects.toMatchObject({ code: 'insufficient_stock' })
    expect(await snapshot()).toEqual(before)
  })

  it('a purchase that fails on its payment leaves nothing behind', async () => {
    const a = await product('Pen', 0)
    const sup = await createSupplier(db, owner, { name: 'Dealer' })
    const before = await snapshot()
    await expect(
      createPurchase(db, owner, { idempotencyKey: newId(), supplierId: sup.id, purchaseDate: '2026-11-10', items: [{ productId: a.p.id, unitId: a.piece.id, quantity: '10', unitCost: 5_00 }], paid: 999_00 }),
    ).rejects.toMatchObject({ code: 'overpaid' })
    expect(await snapshot()).toEqual(before)
  })

  it('a return whose second line is invalid restocks nothing', async () => {
    const a = await product('Pen', 10)
    const b = await product('Ink', 10)
    const sale = await createSale(db, owner, {
      idempotencyKey: newId(),
      priceMode: 'retail',
      items: [
        { productId: a.p.id, unitId: a.piece.id, quantity: '3', unitPrice: 10_00 },
        { productId: b.p.id, unitId: b.piece.id, quantity: '1', unitPrice: 10_00 },
      ],
      payments: [{ method: 'cash', amount: 40_00 }],
    })
    const before = await snapshot()
    await expect(
      createSaleReturn(db, owner, {
        idempotencyKey: newId(),
        saleId: sale.id,
        items: [
          { saleItemId: sale.items[0].id, quantity: '2', condition: 'resalable' },
          { saleItemId: sale.items[1].id, quantity: '5', condition: 'resalable' },
        ],
        reason: 'test',
      }),
    ).rejects.toMatchObject({ code: 'return_too_much' })
    expect(await snapshot()).toEqual(before)
  })
})

describe('concurrency', () => {
  it('two cashiers selling the last 3 units at the same moment: exactly one succeeds', async () => {
    const a = await product('Pen', 3)
    const sell = () => createSale(db, owner, { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: a.p.id, unitId: a.piece.id, quantity: '3', unitPrice: 10_00 }], payments: [{ method: 'cash', amount: 30_00 }] })
    const results = await Promise.allSettled([sell(), sell()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const [p] = await db.select().from(products).where(eq(products.id, a.p.id))
    expect(p.stockQty).toBe(0)
  })

  it('invoice numbers stay unique and gapless under parallel sales', async () => {
    const a = await product('Pen', 50)
    const one = () => createSale(db, owner, { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: a.p.id, unitId: a.piece.id, quantity: '1', unitPrice: 10_00 }], payments: [{ method: 'cash', amount: 10_00 }] })
    const done = await Promise.all(Array.from({ length: 8 }, one))
    expect(done.map((s) => s.invoiceNo).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `INV-${String(i + 1).padStart(6, '0')}`))
    const [p] = await db.select().from(products).where(eq(products.id, a.p.id))
    expect(p.stockQty).toBe(42)
  })
})
