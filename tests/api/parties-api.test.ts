// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import type { LedgerEntry, SaleReturnRecord } from '@/lib/parties'
import type { Customer, SaleDetail } from '@/lib/sales'
import { apiJson } from '../helpers/api'

describe('customers, payments and returns API', () => {
  it('sells on due, returns an item, collects the rest, and the ledger shows it all', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    const piece = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 100_00, wholesalePrice: 0, purchasePrice: 0 }
    const p = await apiJson<{ id: string }>('POST', '/api/products', { name: 'Torch', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [piece], barcodes: [] })
    await apiJson('POST', '/api/inventory/adjust', { productId: p.body.id, type: 'opening', unitId: piece.id, quantity: '5', unitCost: 60_00 })
    const c = await apiJson<Customer>('POST', '/api/customers', { name: 'Hasan', phone: '01700000001' })

    const sale = await apiJson<SaleDetail>('POST', '/api/sales', { idempotencyKey: newId(), customerId: c.body.id, priceMode: 'retail', items: [{ productId: p.body.id, unitId: piece.id, quantity: '3', unitPrice: 100_00 }], payments: [] })
    expect(sale.body.due).toBe(300_00)

    const ret = await apiJson<SaleReturnRecord>('POST', '/api/sale-returns', { idempotencyKey: newId(), saleId: sale.body.id, items: [{ saleItemId: sale.body.items[0].id, quantity: '1', condition: 'resalable' }], reason: 'Not working' })
    expect(ret.status).toBe(201)
    expect(ret.body).toMatchObject({ total: 100_00, dueAdjusted: 100_00, refund: 0 })

    expect((await apiJson('POST', '/api/payments/collect', { idempotencyKey: newId(), partyId: c.body.id, amount: 300_00, method: 'cash' })).status).toBe(400)
    expect((await apiJson('POST', '/api/payments/collect', { idempotencyKey: newId(), partyId: c.body.id, amount: 200_00, method: 'cash' })).status).toBe(201)

    const detail = await apiJson<{ customer: Customer; ledger: LedgerEntry[] }>('GET', `/api/customers/${c.body.id}`)
    expect(detail.body.customer.balance).toBe(0)
    expect(detail.body.ledger.map((e) => [e.kind, e.change, e.balance])).toEqual([
      ['sale', 300_00, 300_00],
      ['sale_return', -100_00, 200_00],
      ['payment', -200_00, 0],
    ])
    expect((await apiJson<{ total: number }>('GET', '/api/payments')).body.total).toBe(1)
    expect((await apiJson<{ total: number }>('GET', '/api/sale-returns')).body.total).toBe(1)
  })
})
