// @vitest-environment node
import { asc, count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import { purchaseTotals } from '@/lib/inventory'
import type { ProductInput } from '@/lib/product'
import { type Db, getDb } from '@/server/db'
import { auditLogs, productBatches, products, productUnits, stockMovements, suppliers } from '@/server/db/schema'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { adjustStock, listBatches, listMovements, stockOut } from '@/server/services/inventory'
import { createProduct, deleteProduct } from '@/server/services/product'
import { cancelPurchase, createPurchase, listPurchases } from '@/server/services/purchase'
import { createSupplier } from '@/server/services/supplier'

let db: Db
let owner: Actor
let defaultSupplier: string
const cashier: Actor = { id: 'cashier-1', name: 'Rafi', role: 'cashier' }

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
  defaultSupplier = (await createSupplier(db, owner, { name: 'Default Supplier' })).id
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

async function rice(extra: Partial<ProductInput> = {}) {
  const units = [unit('Gram', 1, { canSell: false }), unit('KG', 1000, { retailPrice: 7800 }), unit('Sack', 25_000)]
  const p = await createProduct(db, owner, { name: 'Miniket Rice', allowFraction: true, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units, barcodes: [], ...extra })
  return { p, gram: units[0], kg: units[1], sack: units[2] }
}

async function milk() {
  const units = [unit('Piece', 1), unit('Carton', 12)]
  const p = await createProduct(db, owner, { name: 'Milk Pack', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: true, trackExpiry: true, units, barcodes: [] })
  return { p, piece: units[0], carton: units[1] }
}

const stockOf = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]
const movementsOf = (id: string) => db.select().from(stockMovements).where(eq(stockMovements.productId, id)).orderBy(asc(stockMovements.createdAt))
const purchase = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  createPurchase(db, owner, { idempotencyKey: newId(), purchaseDate: '2026-11-10', items: items as never, supplierId: defaultSupplier, ...extra })

describe('purchase totals', () => {
  it('spreads discount and transport over lines so landed costs add up exactly', () => {
    const t = purchaseTotals(
      [
        { quantity: '3', unitCost: 100_00 },
        { quantity: '1', unitCost: 50_00 },
        { quantity: '2.5', unitCost: 33_33 },
      ],
      10_00,
      7_01,
      200_00,
    )
    expect(t.amounts).toEqual([300_00, 50_00, 83_33])
    expect(t.subtotal).toBe(433_33)
    expect(t.total).toBe(433_33 - 10_00 + 7_01)
    expect(t.landed.reduce((a, b) => a + b, 0)).toBe(t.total)
    expect(t.due).toBe(t.total - 200_00)
  })
})

describe('purchases', () => {
  it('5 sacks of rice add 125 KG (125,000 g) at landed cost, with a supplier due', async () => {
    const { p, sack } = await rice()
    const s = await createSupplier(db, owner, { name: 'Rahim Traders', phone: '01700000000' })
    const res = await purchase([{ productId: p.id, unitId: sack.id, quantity: '5', unitCost: 1800_00 }], { supplierId: s.id, additionalCost: 250_00, paid: 5000_00 })

    expect(res).toMatchObject({ purchaseNo: 'PUR-000001', supplierName: 'Rahim Traders', subtotal: 9000_00, total: 9250_00, paid: 5000_00, due: 4250_00, status: 'completed' })
    expect(res.items[0]).toMatchObject({ unitName: 'Sack', unitFactor: 25_000, quantity: '5', baseQty: 125_000, amount: 9000_00, lineTotal: 9250_00 })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 125_000, stockValue: 9250_00 })
    expect((await db.select().from(suppliers).where(eq(suppliers.id, s.id)))[0].balance).toBe(4250_00)

    const [m] = await movementsOf(p.id)
    expect(m).toMatchObject({ type: 'purchase', qtyChange: 125_000, valueChange: 9250_00, balanceAfter: 125_000, refType: 'purchase', refId: res.id })
    // The sack's purchase price now suggests the latest cost.
    const [u] = await db.select().from(productUnits).where(eq(productUnits.id, sack.id))
    expect(u.purchasePrice).toBe(1800_00)
  })

  it('keeps a weighted-average cost across purchases', async () => {
    const { p, kg } = await rice()
    await purchase([{ productId: p.id, unitId: kg.id, quantity: '10', unitCost: 70_00 }])
    await purchase([{ productId: p.id, unitId: kg.id, quantity: '10', unitCost: 80_00 }])
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 20_000, stockValue: 1500_00 })
    // Writing off 1.5 KG removes 1.5 × ৳75 average.
    await adjustStock(db, owner, { productId: p.id, type: 'damaged', unitId: kg.id, quantity: '1.5', reason: 'Wet bag' })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 18_500, stockValue: 1500_00 - 112_50 })
  })

  it('rejects quantities that do not fit the unit, credit without a supplier and overpayment', async () => {
    const { p, kg } = await rice()
    const choc = await createProduct(db, owner, { name: 'Chocolate', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [unit('Piece', 1)], barcodes: [] })
    const [piece] = await db.select().from(productUnits).where(eq(productUnits.productId, choc.id))
    await expect(purchase([{ productId: choc.id, unitId: piece.id, quantity: '2.5', unitCost: 100 }])).rejects.toMatchObject({ code: 'invalid_quantity' })
    await expect(purchase([{ productId: p.id, unitId: kg.id, quantity: '0.0001', unitCost: 100 }])).rejects.toMatchObject({ code: 'invalid_quantity' })
    await expect(purchase([{ productId: p.id, unitId: kg.id, quantity: '1', unitCost: 100_00 }], { supplierId: undefined })).rejects.toMatchObject({ code: 'due_needs_supplier' })
    await expect(purchase([{ productId: p.id, unitId: kg.id, quantity: '1', unitCost: 100_00 }], { paid: 200_00 })).rejects.toMatchObject({ code: 'overpaid' })
    await expect(purchase([{ productId: p.id, unitId: piece.id, quantity: '1', unitCost: 1 }], { paid: 1 })).rejects.toMatchObject({ code: 'invalid_unit' })
    // Nothing was stored by the failed attempts.
    expect((await stockOf(p.id)).stockQty).toBe(0)
    expect((await listPurchases(db, {})).total).toBe(0)
  })

  it('returns the same purchase when the same submission arrives twice', async () => {
    const { p, kg } = await rice()
    const input = { idempotencyKey: 'click-123456', purchaseDate: '2026-11-10', items: [{ productId: p.id, unitId: kg.id, quantity: '2', unitCost: 0 }] }
    const [a, b] = await Promise.all([createPurchase(db, owner, input), createPurchase(db, owner, input)])
    expect(a.id).toBe(b.id)
    expect((await stockOf(p.id)).stockQty).toBe(2000)
  })

  it('cancels by reversing stock and the supplier due; refuses when the stock was used', async () => {
    const { p, kg } = await rice()
    const s = await createSupplier(db, owner, { name: 'Rahim Traders' })
    const first = await purchase([{ productId: p.id, unitId: kg.id, quantity: '10', unitCost: 70_00 }], { supplierId: s.id })
    const second = await purchase([{ productId: p.id, unitId: kg.id, quantity: '5', unitCost: 80_00 }], { supplierId: s.id })

    const cancelled = await cancelPurchase(db, owner, second.id, { reason: 'Entered twice' })
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Entered twice' })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 10_000, stockValue: 700_00 })
    expect((await db.select().from(suppliers).where(eq(suppliers.id, s.id)))[0].balance).toBe(700_00)
    expect((await movementsOf(p.id)).at(-1)).toMatchObject({ type: 'purchase_cancel', qtyChange: -5000, valueChange: -400_00 })
    await expect(cancelPurchase(db, owner, second.id, { reason: 'again' })).rejects.toMatchObject({ code: 'conflict' })

    await adjustStock(db, owner, { productId: p.id, type: 'lost', unitId: kg.id, quantity: '1', reason: 'Missing' })
    await expect(cancelPurchase(db, owner, first.id, { reason: 'Wrong' })).rejects.toMatchObject({ code: 'stock_used' })
    expect((await stockOf(p.id)).stockQty).toBe(9000)
    expect((await listPurchases(db, { status: 'completed' })).items.map((x) => x.id)).toEqual([first.id])
  })

  it('needs purchase permission and blocks deleting a purchased product', async () => {
    const { p, kg } = await rice()
    await expect(createPurchase(db, cashier, { idempotencyKey: newId(), purchaseDate: '2026-11-10', items: [{ productId: p.id, unitId: kg.id, quantity: '1', unitCost: 0 }] })).rejects.toMatchObject({ code: 'forbidden' })
    await purchase([{ productId: p.id, unitId: kg.id, quantity: '1', unitCost: 0 }])
    await expect(deleteProduct(db, owner, p.id)).rejects.toMatchObject({ code: 'has_history' })
  })
})

describe('batches and expiry', () => {
  it('requires expiry dates, then sells first-expired-first-out', async () => {
    const { p, carton, piece } = await milk()
    await expect(purchase([{ productId: p.id, unitId: carton.id, quantity: '1', unitCost: 0 }])).rejects.toMatchObject({ code: 'expiry_required' })

    await purchase([
      { productId: p.id, unitId: carton.id, quantity: '1', unitCost: 1200_00, batchNo: 'LATE', expiryDate: '2027-03-01' },
      { productId: p.id, unitId: carton.id, quantity: '1', unitCost: 1200_00, batchNo: 'SOON', expiryDate: '2026-12-01' },
    ])
    expect((await stockOf(p.id)).stockQty).toBe(24)

    // 15 pieces: 12 from the batch expiring first, 3 from the next.
    await db.transaction((tx) => stockOut(tx, owner, { productId: p.id, type: 'sale', qty: 15, allowNegative: false }).then(() => undefined))
    const batches = await db.select().from(productBatches).where(eq(productBatches.productId, p.id)).orderBy(asc(productBatches.expiryDate))
    expect(batches.map((b) => [b.batchNo, b.qtyRemaining, b.status])).toEqual([
      ['SOON', 0, 'depleted'],
      ['LATE', 9, 'active'],
    ])
    const out = (await movementsOf(p.id)).filter((m) => m.type === 'sale')
    expect(out.map((m) => m.qtyChange).sort()).toEqual([-12, -3])

    // Writing off a chosen batch takes from that batch only.
    await adjustStock(db, owner, { productId: p.id, type: 'expired', unitId: piece.id, quantity: '9', batchId: batches[1].id, reason: 'Spoiled' })
    expect((await stockOf(p.id)).stockQty).toBe(0)
  })

  it('lists expired and soon-expiring batches that still hold stock', async () => {
    const { p, carton } = await milk()
    await purchase([
      { productId: p.id, unitId: carton.id, quantity: '1', unitCost: 0, batchNo: 'OLD', expiryDate: '2026-11-01' },
      { productId: p.id, unitId: carton.id, quantity: '1', unitCost: 0, batchNo: 'NEXT', expiryDate: '2026-11-20' },
      { productId: p.id, unitId: carton.id, quantity: '1', unitCost: 0, batchNo: 'FAR', expiryDate: '2027-06-01' },
    ])
    const names = async (state: 'expired' | 'expiring' | 'in_stock') => (await listBatches(db, { state, warningDays: 30, today: '2026-11-10' })).map((b) => b.batchNo)
    expect(await names('expired')).toEqual(['OLD'])
    expect(await names('expiring')).toEqual(['NEXT'])
    expect(await names('in_stock')).toEqual(['OLD', 'NEXT', 'FAR'])
  })
})

describe('stock adjustments', () => {
  it('records opening stock and corrections, never going below zero', async () => {
    const { p, kg, sack } = await rice()
    await adjustStock(db, owner, { productId: p.id, type: 'opening', unitId: sack.id, quantity: '2', unitCost: 1700_00 })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 50_000, stockValue: 3400_00 })

    await expect(adjustStock(db, owner, { productId: p.id, type: 'adjustment_decrease', unitId: kg.id, quantity: '1' })).rejects.toThrow()
    await expect(adjustStock(db, owner, { productId: p.id, type: 'adjustment_decrease', unitId: sack.id, quantity: '3', reason: 'Count' })).rejects.toMatchObject({ code: 'insufficient_stock' })
    await expect(adjustStock(db, cashier, { productId: p.id, type: 'adjustment_increase', unitId: kg.id, quantity: '1', reason: 'x' })).rejects.toMatchObject({ code: 'forbidden' })

    await adjustStock(db, owner, { productId: p.id, type: 'adjustment_decrease', unitId: sack.id, quantity: '2', reason: 'Recount' })
    expect(await stockOf(p.id)).toMatchObject({ stockQty: 0, stockValue: 0 })

    const page = await listMovements(db, { productId: p.id })
    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({ type: 'adjustment_decrease', qtyChange: -50_000, balanceAfter: 0, reason: 'Recount', userName: 'Karim', productName: 'Miniket Rice' })
    const [audits] = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.action, 'stock.adjust'))
    expect(audits.n).toBe(2)
  })

  it('movement history always adds up to the stock', async () => {
    const { p, kg } = await rice()
    await purchase([{ productId: p.id, unitId: kg.id, quantity: '12.5', unitCost: 70_00 }])
    await adjustStock(db, owner, { productId: p.id, type: 'adjustment_increase', unitId: kg.id, quantity: '0.25', reason: 'Found' })
    await adjustStock(db, owner, { productId: p.id, type: 'damaged', unitId: kg.id, quantity: '3', reason: 'Rats' })
    const moves = await movementsOf(p.id)
    const s = await stockOf(p.id)
    expect(moves.reduce((a, m) => a + m.qtyChange, 0)).toBe(s.stockQty)
    expect(moves.reduce((a, m) => a + m.valueChange, 0)).toBe(s.stockValue)
  })
})
