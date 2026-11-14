// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import type { CatalogSnapshot, ProductDetail } from '@/lib/product'
import type { Product } from '@/types/db'
import { apiJson, callApi } from '../helpers/api'

const owner = { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' }

const rice = () => ({
  name: 'Miniket Rice',
  sku: 'rice-1',
  allowFraction: true,
  minStockQty: 25_000,
  taxRate: 0,
  trackBatches: false,
  trackExpiry: false,
  units: [
    { id: newId(), name: 'Gram', factor: 1, isBase: true, canPurchase: false, canSell: true, retailPrice: 8, wholesalePrice: 8, purchasePrice: 7 },
    { id: newId(), name: 'KG', factor: 1000, isBase: false, canPurchase: false, canSell: true, retailPrice: 7800, wholesalePrice: 7400, purchasePrice: 0 },
    { id: newId(), name: 'Sack', factor: 25_000, isBase: false, canPurchase: true, canSell: true, retailPrice: 190_000, wholesalePrice: 182_500, purchasePrice: 175_000 },
  ],
  barcodes: [],
})

describe('auth API', () => {
  it('runs first-run setup once, then requires login', async () => {
    expect((await apiJson('GET', '/api/setup')).body).toEqual({ needsSetup: true })
    const setup = await apiJson<{ user: { role: string } }>('POST', '/api/setup', owner)
    expect(setup.status).toBe(201)
    expect(setup.body.user.role).toBe('owner')
    // Setup signed the owner in.
    expect((await apiJson('GET', '/api/auth/me')).status).toBe(200)
    // A second setup is refused.
    expect((await apiJson('POST', '/api/setup', owner)).status).toBe(409)

    await callApi('POST', '/api/auth/logout')
    expect((await apiJson('GET', '/api/auth/me')).status).toBe(401)
    expect((await apiJson('GET', '/api/products')).status).toBe(401)

    const info = await apiJson<{ shopName: string; demo: unknown }>('GET', '/api/auth/users')
    expect(info.body.shopName).toBe('Rahman Store')
    // Real accounts are never listed on the public login screen, and there is no demo user here.
    expect(info.body).not.toHaveProperty('users')
    expect(info.body.demo).toBeNull()
    expect(JSON.stringify(info.body)).not.toMatch(/owner|pin/i)

    expect((await apiJson('POST', '/api/auth/login', { username: 'owner', pin: '0000' })).status).toBe(400)
    expect((await apiJson('POST', '/api/auth/login', { username: 'owner', pin: '2468' })).status).toBe(200)
    expect((await apiJson('GET', '/api/auth/me')).status).toBe(200)
  })

  it('returns validation errors as 400 with a message', async () => {
    const res = await apiJson<{ error: { code: string; message: string } }>('POST', '/api/setup', { ...owner, pin: '12' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('PIN must be at least 4 characters')
  })
})

describe('products API', () => {
  it('creates, reads, lists, updates, archives and deletes a product', async () => {
    await apiJson('POST', '/api/setup', owner)

    const created = await apiJson<Product>('POST', '/api/products', rice())
    expect(created.status).toBe(201)
    expect(created.body.sku).toBe('RICE-1')

    const detail = await apiJson<ProductDetail>('GET', `/api/products/${created.body.id}`)
    expect(detail.body.units.map((u) => [u.name, u.factor])).toEqual([
      ['Gram', 1],
      ['KG', 1000],
      ['Sack', 25_000],
    ])

    const list = await apiJson<CatalogSnapshot>('GET', '/api/products')
    expect(list.body.products).toHaveLength(1)
    expect(list.body.units).toHaveLength(3)

    const update = { ...rice(), units: detail.body.units.map((u) => ({ ...u, symbol: u.symbol })), name: 'Miniket Rice (25kg)' }
    expect((await apiJson('PUT', `/api/products/${created.body.id}`, update)).status).toBe(200)
    expect((await apiJson<ProductDetail>('GET', `/api/products/${created.body.id}`)).body.product.name).toBe('Miniket Rice (25kg)')

    expect((await apiJson('PATCH', `/api/products/${created.body.id}`, { status: 'archived' })).status).toBe(200)
    expect((await callApi('DELETE', `/api/products/${created.body.id}`)).status).toBe(204)
    expect((await apiJson('GET', `/api/products/${created.body.id}`)).status).toBe(404)
  })

  it('maps business errors to HTTP statuses', async () => {
    await apiJson('POST', '/api/setup', owner)
    await apiJson('POST', '/api/products', rice())
    const dup = await apiJson<{ error: { message: string } }>('POST', '/api/products', rice())
    expect(dup.status).toBe(409)
    expect(dup.body.error.message).toContain('already used')
    expect((await apiJson('GET', '/api/products/not-a-uuid')).status).toBe(400)
    expect((await apiJson('GET', `/api/products/${newId()}`)).status).toBe(404)
  })

  it('exports CSV and rejects a broken import without writing', async () => {
    await apiJson('POST', '/api/setup', owner)
    await apiJson('POST', '/api/products', rice())
    const res = await callApi('GET', '/api/products/export')
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(await res.text()).toContain('RICE-1')

    const bad = await apiJson<{ error: { issues: unknown[] } }>('POST', '/api/products/import', { csv: 'name,unit,factor,is_base\nX,Piece,0,yes\n' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.issues.length).toBeGreaterThan(0)
  })

  it('looks up barcodes and generates new ones', async () => {
    await apiJson('POST', '/api/setup', owner)
    const { body: gen } = await apiJson<{ code: string }>('POST', '/api/barcodes/generate', {})
    expect(gen.code).toMatch(/^2\d{12}$/)
    const input = rice()
    input.barcodes = [{ code: gen.code, unitId: input.units[2].id }] as never
    await apiJson('POST', '/api/products', input)
    const hit = await apiJson<{ unit?: { name: string } }>('GET', `/api/barcodes/lookup?code=${gen.code}`)
    expect(hit.body.unit?.name).toBe('Sack')
    expect((await apiJson('GET', '/api/barcodes/lookup?code=000')).status).toBe(404)
  })
})
