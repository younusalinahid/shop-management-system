// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import type { MovementRow, Page, PurchaseDetail, PurchaseSummary, Supplier } from '@/lib/inventory'
import type { Product } from '@/types/db'
import { setTestCookie } from '../helpers/cookies'
import { apiJson } from '../helpers/api'

const units = () => [
  { id: newId(), name: 'Gram', factor: 1, isBase: true, canPurchase: false, canSell: false, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0 },
  { id: newId(), name: 'KG', factor: 1000, isBase: false, canPurchase: true, canSell: true, retailPrice: 7800, wholesalePrice: 0, purchasePrice: 0 },
  { id: newId(), name: 'Sack', factor: 25_000, isBase: false, canPurchase: true, canSell: true, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0 },
]

async function setupShop() {
  await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
  const u = units()
  const product = await apiJson<Product>('POST', '/api/products', { name: 'Miniket Rice', allowFraction: true, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: u, barcodes: [] })
  return { product: product.body, kg: u[1], sack: u[2] }
}

describe('inventory and purchase API', () => {
  it('saves a purchase, lists it, and shows its stock movement', async () => {
    const { product, sack } = await setupShop()
    const supplier = await apiJson<Supplier>('POST', '/api/suppliers', { name: 'Rahim Traders', phone: '01711111111' })
    expect(supplier.status).toBe(201)

    const body = { idempotencyKey: newId(), supplierId: supplier.body.id, purchaseDate: '2026-11-10', items: [{ productId: product.id, unitId: sack.id, quantity: '5', unitCost: 180_000 }], paid: 500_000 }
    const saved = await apiJson<PurchaseDetail>('POST', '/api/purchases', body)
    expect(saved.status).toBe(201)
    expect(saved.body).toMatchObject({ purchaseNo: 'PUR-000001', total: 900_000, due: 400_000 })
    expect(saved.body.items[0]).toMatchObject({ baseQty: 125_000, baseUnitName: 'Gram' })
    // The same click retried: same purchase, no second stock-in.
    expect((await apiJson<PurchaseDetail>('POST', '/api/purchases', body)).body.id).toBe(saved.body.id)

    const list = await apiJson<Page<PurchaseSummary> & { totals: { due: number } }>('GET', '/api/purchases?q=rice')
    expect(list.body.total).toBe(1)
    expect(list.body.totals.due).toBe(400_000)
    expect((await apiJson<PurchaseDetail>('GET', `/api/purchases/${saved.body.id}`)).body.items).toHaveLength(1)

    const moves = await apiJson<Page<MovementRow>>('GET', `/api/inventory/movements?productId=${product.id}`)
    expect(moves.body.items).toHaveLength(1)
    expect(moves.body.items[0]).toMatchObject({ type: 'purchase', qtyChange: 125_000, userName: 'Karim', reason: 'PUR-000001' })
  })

  it('adjusts stock with translated errors and cancels a purchase', async () => {
    const { product, kg } = await setupShop()
    const adj = await apiJson<{ stockQty: number }>('POST', '/api/inventory/adjust', { productId: product.id, type: 'opening', unitId: kg.id, quantity: '10', unitCost: 7000 })
    expect(adj.body.stockQty).toBe(10_000)

    const tooMuch = await apiJson<{ error: { code: string; message: string } }>('POST', '/api/inventory/adjust', { productId: product.id, type: 'lost', unitId: kg.id, quantity: '11', reason: 'Count' })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error).toMatchObject({ code: 'insufficient_stock', message: 'Not enough stock of “Miniket Rice”. Available: 10,000 Gram.' })

    setTestCookie('NEXT_LOCALE', 'bn')
    const noReason = await apiJson<{ error: { message: string } }>('POST', '/api/inventory/adjust', { productId: product.id, type: 'lost', unitId: kg.id, quantity: '1' })
    expect(noReason.body.error.message).toBe('কারণ লিখুন')
    setTestCookie('NEXT_LOCALE', 'en')

    const p = await apiJson<PurchaseDetail>('POST', '/api/purchases', { idempotencyKey: newId(), purchaseDate: '2026-11-10', items: [{ productId: product.id, unitId: kg.id, quantity: '2', unitCost: 7500 }], paid: 15_000 })
    expect((await apiJson('POST', `/api/purchases/${p.body.id}/cancel`, {})).status).toBe(400)
    const cancelled = await apiJson<PurchaseDetail>('POST', `/api/purchases/${p.body.id}/cancel`, { reason: 'Wrong product' })
    expect(cancelled.body.status).toBe('cancelled')
    expect((await apiJson<{ items: unknown[] }>('GET', '/api/inventory/batches?state=all')).status).toBe(200)

    const dash = await apiJson<{ stockValue: number }>('GET', '/api/dashboard')
    expect(dash.body.stockValue).toBe(70_000)
  })
})
