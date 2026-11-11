// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import type { ReportResult } from '@/lib/reports'
import { apiJson } from '../helpers/api'

describe('dashboard and reports API', () => {
  it('serves dashboard figures, charts and reports', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    const piece = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 50_00, wholesalePrice: 0, purchasePrice: 0 }
    const p = await apiJson<{ id: string }>('POST', '/api/products', { name: 'Bulb', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [piece], barcodes: [] })
    await apiJson('POST', '/api/inventory/adjust', { productId: p.body.id, type: 'opening', unitId: piece.id, quantity: '10', unitCost: 30_00 })
    await apiJson('POST', '/api/sales', { idempotencyKey: newId(), priceMode: 'retail', items: [{ productId: p.body.id, unitId: piece.id, quantity: '2', unitPrice: 50_00 }], payments: [{ method: 'cash', amount: 100_00 }] })

    const dash = await apiJson<Record<string, unknown>>('GET', '/api/dashboard')
    expect(dash.body).toMatchObject({ todaySales: 100_00, todayInvoices: 1, todayCollection: 100_00, todayProfit: 40_00, todayNetProfit: 40_00, stockValue: 240_00 })
    expect((dash.body.recentSales as unknown[]).length).toBe(1)

    const charts = await apiJson<{ daily: unknown[]; bestSellers: Array<{ product: string }> }>('GET', '/api/dashboard/charts')
    expect(charts.status).toBe(200)
    expect(charts.body.bestSellers[0].product).toBe('Bulb')

    const r = await apiJson<ReportResult>('GET', '/api/reports/sales-product')
    expect(r.body.rows).toEqual([{ product: 'Bulb', sku: 'P00001', qty: 2, unit: 'Piece', sales: 100_00, cost: 60_00, profit: 40_00 }])
    expect((await apiJson('GET', '/api/reports/no-such-report')).status).toBe(404)

  })
})
