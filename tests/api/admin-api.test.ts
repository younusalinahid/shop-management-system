// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'
import type { CatalogSnapshot } from '@/lib/product'
import type { BackupFile } from '@/server/services/backup'
import type { AuditRecord } from '@/server/services/audit-log'
import type { UserRecord } from '@/server/services/users'
import { apiJson, callApi } from '../helpers/api'

const signIn = (username: string, pin: string) => apiJson('POST', '/api/auth/login', { username, pin })

describe('users and permissions API', () => {
  it('manages users, protects the last owner, and enforces roles', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    const me = (await apiJson<{ items: UserRecord[] }>('GET', '/api/users')).body.items[0]

    const rafi = await apiJson<UserRecord>('POST', '/api/users', { name: 'Rafi', username: 'Rafi', role: 'cashier', pin: '1357' })
    expect(rafi.body).toMatchObject({ username: 'rafi', role: 'cashier' })
    expect((await apiJson('POST', '/api/users', { name: 'X', username: 'rafi', role: 'cashier', pin: '1357' })).status).toBe(409)

    // The only owner can neither be demoted nor disabled.
    expect((await apiJson<{ error: { code: string } }>('PUT', `/api/users/${me.id}`, { name: 'Karim', role: 'manager' })).body.error.code).toBe('last_owner')
    expect((await apiJson('PATCH', `/api/users/${me.id}`, { status: 'archived' })).status).toBe(409)

    // Own PIN change needs the current PIN.
    expect((await apiJson('POST', '/api/auth/pin', { currentPin: '0000', newPin: '9876' })).status).toBe(400)
    expect((await apiJson('POST', '/api/auth/pin', { currentPin: '2468', newPin: '9876' })).status).toBe(200)

    // A cashier cannot manage users, see reports or the audit log.
    await callApi('POST', '/api/auth/logout')
    expect((await signIn('rafi', '1357')).status).toBe(200)
    expect((await apiJson('GET', '/api/users')).status).toBe(403)
    expect((await apiJson('GET', '/api/reports/sales-product')).status).toBe(403)
    expect((await apiJson('GET', '/api/audit')).status).toBe(403)
    const dash = await apiJson<Record<string, unknown>>('GET', '/api/dashboard')
    expect(dash.body).toMatchObject({ stockValue: null, todayProfit: null, supplierDue: null })

    // Disabling a user signs them out.
    await callApi('POST', '/api/auth/logout')
    await signIn('owner', '9876')
    await apiJson('PATCH', `/api/users/${rafi.body.id}`, { status: 'archived' })
    expect((await signIn('rafi', '1357')).status).toBe(400)

    const audit = await apiJson<{ items: AuditRecord[]; modules: string[] }>('GET', '/api/audit?module=users')
    expect(audit.body.items.map((a) => a.action)).toEqual(expect.arrayContaining(['user.create', 'user.pin_change', 'user.disable']))
  })
})

describe('backup and restore API', () => {
  it('exports everything, restores it atomically, and refuses foreign files', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    const unit = { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 10_00, wholesalePrice: 0, purchasePrice: 0 }
    const cat = await apiJson<{ id: string }>('POST', '/api/categories', { name: 'Stationery' })
    await apiJson('POST', '/api/categories', { name: 'Pens', parentId: cat.body.id })
    await apiJson('POST', '/api/products', { name: 'Pen', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [unit], barcodes: [] })

    const res = await callApi('GET', '/api/backup')
    expect(res.headers.get('Content-Disposition')).toMatch(/shop-backup-\d+\.json/)
    const backup = (await res.json()) as BackupFile
    expect(backup.counts).toMatchObject({ products: 1, categories: 2, users: 1 })

    // Change data after the backup, then restore: the change is gone.
    await apiJson('POST', '/api/products', { name: 'Pencil', allowFraction: false, minStockQty: 0, taxRate: 0, trackBatches: false, trackExpiry: false, units: [{ ...unit, id: newId() }], barcodes: [] })
    expect((await apiJson('POST', '/api/backup/inspect', backup)).status).toBe(200)
    expect((await apiJson('POST', '/api/backup/inspect', { ...backup, schemaVersion: '0000_init' })).status).toBe(400)
    expect((await apiJson('POST', '/api/backup/restore', { confirm: 'yes', backup })).status).toBe(400)
    const restored = await apiJson<{ counts: Record<string, number> }>('POST', '/api/backup/restore', { confirm: 'RESTORE', backup })
    expect(restored.status).toBe(200)

    // Everyone is signed out; sign in again and the data is the backup's.
    expect((await apiJson('GET', '/api/products')).status).toBe(401)
    await signIn('owner', '2468')
    const catalog = await apiJson<CatalogSnapshot>('GET', '/api/products')
    expect(catalog.body.products.map((p) => p.name)).toEqual(['Pen'])
    expect(catalog.body.categories).toHaveLength(2)

    const csv = await (await callApi('GET', '/api/export/customers')).text()
    expect(csv.split('\r\n')[0]).toContain('name,phone')
  })
})
