// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { todayDateOnly } from '@/lib/datetime'
import { newId } from '@/lib/id'
import { REPORT_NAMES } from '@/lib/reports'
import { type Db, getDb } from '@/server/db'
import type { Actor } from '@/server/services/audit'
import { createInitialOwner } from '@/server/services/auth'
import { createCustomer } from '@/server/services/customer'
import { createExpense } from '@/server/services/finance'
import { adjustStock } from '@/server/services/inventory'
import { createProduct } from '@/server/services/product'
import { createPurchase } from '@/server/services/purchase'
import { hideCostColumns, runReport } from '@/server/services/reports'
import { createSale } from '@/server/services/sale'
import { createSupplier } from '@/server/services/supplier'

let db: Db
let owner: Actor
const today = todayDateOnly()

beforeEach(async () => {
  db = await getDb()
  const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
  owner = { id: o.id, name: o.name, role: 'owner' }
  const piece = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 10_00, wholesalePrice: 9_00, purchasePrice: 6_00 }
  const pen = await createProduct(db, owner, { name: 'Pen', allowFraction: false, minStockQty: 50, taxRate: 0, trackBatches: false, trackExpiry: false, units: [piece], barcodes: [] })
  const sup = await createSupplier(db, owner, { name: 'Stationery Co' })
  await createPurchase(db, owner, { idempotencyKey: newId(), supplierId: sup.id, purchaseDate: today, items: [{ productId: pen.id, unitId: piece.id, quantity: '60', unitCost: 6_00 }], paid: 200_00 })
  const c = await createCustomer(db, owner, { name: 'Hasan' })
  await createSale(db, owner, { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: pen.id, unitId: piece.id, quantity: '12', unitPrice: 10_00 }], payments: [{ method: 'cash', amount: 120_00 }] })
  await createSale(db, owner, { idempotencyKey: newId(), customerId: c.id, priceMode: 'wholesale', items: [{ productId: pen.id, unitId: piece.id, quantity: '10', unitPrice: 9_00 }], payments: [{ method: 'bkash', amount: 50_00 }] })
  await adjustStock(db, owner, { productId: pen.id, type: 'damaged', unitId: piece.id, quantity: '2', reason: 'Broken' })
  await createExpense(db, owner, { idempotencyKey: newId(), category: 'rent', amount: 100_00, method: 'cash', expenseDate: today })
})

const run = (name: (typeof REPORT_NAMES)[number], period: 'day' | 'week' | 'month' | 'year' = 'day') => runReport(db, name, { from: today, to: today, period })

describe('reports', () => {
  it('every report runs and returns rows matching its columns', async () => {
    for (const name of REPORT_NAMES) {
      const r = await run(name)
      for (const row of r.rows) expect(Object.keys(row).sort(), name).toEqual(r.columns.map((c) => c.key).sort())
    }
  })

  it('sales by period, product, mode and method add up', async () => {
    for (const period of ['day', 'week', 'month', 'year'] as const) {
      const r = await run('sales-period', period)
      expect(r.rows, period).toHaveLength(1)
      expect(r.totals).toMatchObject({ invoices: 2, sales: 210_00, cogs: 132_00, profit: 78_00 })
    }
    expect((await run('sales-product')).rows).toEqual([{ product: 'Pen', sku: 'P00001', qty: 22, unit: 'Piece', sales: 210_00, cost: 132_00, profit: 78_00 }])
    expect((await run('sales-mode')).rows.map((r) => [r.mode, r.sales])).toEqual([
      ['retail', 120_00],
      ['wholesale', 90_00],
    ])
    expect((await run('sales-method')).rows).toEqual([
      { method: 'cash', count: 1, amount: 120_00 },
      { method: 'bkash', count: 1, amount: 50_00 },
    ])
  })

  it('inventory, dues and profit reports', async () => {
    expect((await run('stock-low')).rows).toMatchObject([{ product: 'Pen', qty: 36, minQty: 50 }])
    expect((await run('stock-damaged')).rows).toMatchObject([{ product: 'Pen', type: 'damaged', qty: 2, value: 12_00 }])
    expect((await run('customer-due')).totals).toMatchObject({ balance: 40_00 })
    expect((await run('supplier-due')).totals).toMatchObject({ balance: 160_00 })
    expect((await run('profit-loss')).rows.at(-1)).toEqual({ line: 'netProfit', amount: 78_00 - 12_00 - 100_00 })
    expect((await run('payment-methods')).rows).toEqual([
      { method: 'bkash', in: 50_00, out: 0, net: 50_00 },
      { method: 'cash', in: 120_00, out: 300_00, net: -180_00 },
    ])
  })

  it('removes cost columns for roles that cannot see cost', async () => {
    const r = hideCostColumns(await run('sales-product'))
    expect(r.columns.map((c) => c.key)).toEqual(['product', 'sku', 'qty', 'unit', 'sales'])
    expect(r.rows[0]).not.toHaveProperty('profit')
  })
})
