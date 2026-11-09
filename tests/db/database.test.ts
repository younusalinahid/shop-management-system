import { describe, expect, it } from 'vitest'
import { db, SCHEMA_VERSION, TABLE_NAMES } from '@/db/database'
import { DEFAULT_REGISTER_ID, ensureDefaults } from '@/db/bootstrap'
import type { Product, ProductBarcode } from '@/types/db'
import { newId } from '@/lib/id'
import { formatDocNo, nextCounter } from '@/services/counter-service'

function product(overrides: Partial<Product> = {}): Product {
  const now = Date.now()
  return {
    id: newId(),
    name: 'Miniket Rice',
    sku: 'RICE-001',
    baseUnitName: 'Gram',
    allowFraction: true,
    stockQty: 0,
    stockValue: 0,
    minStockQty: 0,
    taxRate: 0,
    trackBatches: false,
    trackExpiry: false,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('database schema', () => {
  it('opens at the current schema version with every table', () => {
    expect(db.verno).toBe(SCHEMA_VERSION)
    const names = db.tables.map((t) => t.name).sort()
    expect(names).toEqual([...TABLE_NAMES].sort())
    expect(names).toContain('financialLedger')
    expect(names).toHaveLength(29)
  })

  it('enforces unique SKU', async () => {
    await db.products.add(product())
    await expect(db.products.add(product())).rejects.toMatchObject({ name: 'ConstraintError' })
  })

  it('enforces unique barcode across products', async () => {
    const bc = (productId: string): ProductBarcode => ({ id: newId(), code: '8901234567890', productId, createdAt: Date.now() })
    await db.productBarcodes.add(bc('p1'))
    await expect(db.productBarcodes.add(bc('p2'))).rejects.toMatchObject({ name: 'ConstraintError' })
  })

  it('enforces unique sale idempotency key (duplicate submission guard)', async () => {
    const base = {
      customerName: 'Walk-in',
      cashierId: 'u1',
      priceMode: 'retail' as const,
      status: 'completed' as const,
      subtotal: 0,
      itemDiscountTotal: 0,
      invoiceDiscount: 0,
      taxTotal: 0,
      total: 0,
      paid: 0,
      due: 0,
      changeGiven: 0,
      cogs: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.sales.add({ ...base, id: 's1', invoiceNo: 'INV-1', idempotencyKey: 'k1' })
    await expect(db.sales.add({ ...base, id: 's2', invoiceNo: 'INV-2', idempotencyKey: 'k1' })).rejects.toMatchObject({
      name: 'ConstraintError',
    })
  })

  it('supports FEFO ordering via the [productId+expiryDate] index', async () => {
    const mk = (batchNo: string, expiryDate: string) => ({
      id: newId(),
      productId: 'p1',
      batchNo,
      receivedAt: 1,
      expiryDate,
      qtyReceived: 10,
      qtyRemaining: 10,
      costTotal: 100,
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.productBatches.bulkAdd([mk('C', '9999-12-31'), mk('A', '2026-03-01'), mk('B', '2026-06-01')])
    const ordered = await db.productBatches.where('[productId+expiryDate]').between(['p1', ''], ['p1', '￿']).toArray()
    expect(ordered.map((b) => b.batchNo)).toEqual(['A', 'B', 'C'])
  })
})

describe('transactions', () => {
  it('rolls back every write when any step fails', async () => {
    await expect(
      db.transaction('rw', [db.products, db.stockMovements, db.counters], async () => {
        await nextCounter('sale')
        await db.products.add(product())
        await db.stockMovements.add({
          id: newId(),
          productId: 'x',
          type: 'opening',
          qtyChange: 10,
          valueChange: 0,
          balanceAfter: 10,
          userId: 'u',
          createdAt: 1,
        })
        throw new Error('simulated failure')
      }),
    ).rejects.toThrow('simulated failure')
    expect(await db.products.count()).toBe(0)
    expect(await db.stockMovements.count()).toBe(0)
    expect(await db.counters.get('sale')).toBeUndefined()
  })

  it('issues sequential document numbers', async () => {
    const nums = await db.transaction('rw', db.counters, async () => [await nextCounter('sale'), await nextCounter('sale')])
    expect(nums).toEqual([1, 2])
    expect(formatDocNo('INV-', 42)).toBe('INV-000042')
  })
})

describe('ensureDefaults', () => {
  it('creates settings, register and expense categories once', async () => {
    await ensureDefaults()
    await ensureDefaults()
    expect(await db.settings.count()).toBe(1)
    expect(await db.cashRegisters.get(DEFAULT_REGISTER_ID)).toBeDefined()
    expect(await db.expenseCategories.count()).toBe(7)
  })

  it('never overwrites existing settings', async () => {
    await ensureDefaults()
    await db.settings.update('app', { shopName: 'Rahman Store' })
    await ensureDefaults()
    expect((await db.settings.get('app'))?.shopName).toBe('Rahman Store')
  })
})
