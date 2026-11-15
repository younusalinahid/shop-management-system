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

describe('per-user permissions', () => {
  it('lets the owner choose what each user can do, and the server enforces it on every request', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })

    // A manager limited to two permissions (a default manager could also edit products and read the audit log).
    const created = await apiJson<{ id: string }>('POST', '/api/users', { name: 'Mona', username: 'mona', role: 'manager', pin: '1357', permissions: ['sales.view', 'reports.view'] })
    expect(created.status).toBe(201)
    await apiJson('POST', '/api/users', { name: 'Plain', username: 'plain', role: 'manager', pin: '1357' })
    const listed = async (username: string) => (await apiJson<{ items: UserRecord[] }>('GET', '/api/users')).body.items.find((u) => u.username === username)!
    const mona = { body: { id: created.body.id } }
    expect(await listed('mona')).toMatchObject({ customPermissions: true, permissions: ['sales.view', 'reports.view'] })
    // A user without a custom list follows the role.
    const plain = await listed('plain')
    expect(plain.customPermissions).toBe(false)
    expect(plain.permissions).toContain('audit.view')

    // users.manage can never be handed out, and unknown permissions are rejected.
    expect((await apiJson('POST', '/api/users', { name: 'Bad', username: 'bad', role: 'manager', pin: '1357', permissions: ['users.manage'] })).status).toBe(400)
    expect((await apiJson('POST', '/api/users', { name: 'Bad', username: 'bad', role: 'manager', pin: '1357', permissions: ['nope'] })).status).toBe(400)

    await callApi('POST', '/api/auth/logout')
    await signIn('mona', '1357')
    expect((await apiJson('GET', '/api/reports/sales-product')).status).toBe(200)
    expect((await apiJson('GET', '/api/audit')).status).toBe(403)
    expect((await apiJson('POST', '/api/categories', { name: 'Not allowed' })).status).toBe(403)
    expect((await apiJson('GET', '/api/users')).status).toBe(403)

    // The owner changes the list; it applies to Mona's existing session on her very next request.
    await callApi('POST', '/api/auth/logout')
    await signIn('owner', '2468')
    const updated = await apiJson<UserRecord>('PUT', `/api/users/${mona.body.id}`, { name: 'Mona', role: 'manager', permissions: ['audit.view', 'products.edit', 'products.view'] })
    expect(updated.body.permissions).toEqual(['audit.view', 'products.edit', 'products.view'])
    await callApi('POST', '/api/auth/logout')
    await signIn('mona', '1357')
    expect((await apiJson('GET', '/api/audit')).status).toBe(200)
    expect((await apiJson('POST', '/api/categories', { name: 'Now allowed' })).status).toBe(201)
    expect((await apiJson('GET', '/api/reports/sales-product')).status).toBe(403)

    // permissions: null puts her back on the manager defaults.
    await callApi('POST', '/api/auth/logout')
    await signIn('owner', '2468')
    const reset = await apiJson<UserRecord>('PUT', `/api/users/${mona.body.id}`, { name: 'Mona', role: 'manager', permissions: null })
    expect(reset.body.customPermissions).toBe(false)
    // Leaving permissions out keeps the current list.
    await apiJson('PUT', `/api/users/${mona.body.id}`, { name: 'Mona', role: 'manager', permissions: ['sales.view'] })
    const kept = await apiJson<UserRecord>('PUT', `/api/users/${mona.body.id}`, { name: 'Mona B', role: 'manager' })
    expect(kept.body.permissions).toEqual(['sales.view'])

    // Owners always have everything, whatever list is sent.
    await apiJson('POST', '/api/users', { name: 'Boss', username: 'boss', role: 'owner', pin: '1357', permissions: [] })
    expect((await listed('boss')).customPermissions).toBe(false)
    await callApi('POST', '/api/auth/logout')
    await signIn('boss', '1357')
    expect((await apiJson('GET', '/api/users')).status).toBe(200)

    const audit = await apiJson<{ items: AuditRecord[] }>('GET', '/api/audit?module=users')
    expect(audit.body.items.map((a) => a.action)).toContain('user.permissions_change')
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

// A 1x1 transparent PNG.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('profile and logo', () => {
  it('lets any user change their own name and picture, and serves the picture', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    await apiJson('POST', '/api/users', { name: 'Rafi', username: 'rafi', role: 'cashier', pin: '1357' })
    await callApi('POST', '/api/auth/logout')
    await signIn('rafi', '1357')

    const me = (await apiJson<{ user: { id: string; avatarVersion: number | null } }>('GET', '/api/auth/me')).body.user
    expect(me.avatarVersion).toBeNull()
    expect((await callApi('GET', `/api/users/${me.id}/avatar`)).status).toBe(404)

    // Name and picture, by a cashier who has no user-management rights.
    const saved = await apiJson<{ user: UserRecord }>('PATCH', '/api/auth/profile', { name: '  Rafiul  ', avatar: PIXEL })
    expect(saved.status).toBe(200)
    expect(saved.body.user).toMatchObject({ name: 'Rafiul', role: 'cashier' })
    expect(saved.body.user.avatarVersion).not.toBeNull()

    const img = await callApi('GET', `/api/users/${me.id}/avatar`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(20)

    // Bad input is refused; role cannot be changed here.
    expect((await apiJson('PATCH', '/api/auth/profile', { name: '   ' })).status).toBe(400)
    expect((await apiJson('PATCH', '/api/auth/profile', { avatar: 'data:text/html;base64,PGI+' })).status).toBe(400)
    expect((await apiJson('PATCH', '/api/auth/profile', { role: 'owner' })).status).toBe(400)

    // The picture never lands in the audit log, and null removes it.
    expect((await apiJson<{ user: UserRecord }>('PATCH', '/api/auth/profile', { avatar: null })).body.user.avatarVersion).toBeNull()
    await callApi('POST', '/api/auth/logout')
    await signIn('owner', '2468')
    const audit = await apiJson<{ items: AuditRecord[] }>('GET', '/api/audit?module=users')
    expect(JSON.stringify(audit.body.items)).not.toContain('base64')
    expect(audit.body.items.map((a) => a.action)).toContain('user.profile_update')
  })

  it('lets the owner set and remove the shop logo, which the sign-in screen shows', async () => {
    await apiJson('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })
    expect((await apiJson('PATCH', '/api/settings', { logoDataUrl: PIXEL })).status).toBe(200)
    expect((await apiJson<{ logo: string | null }>('GET', '/api/auth/users')).body.logo).toBe(PIXEL)
    expect((await apiJson('PATCH', '/api/settings', { logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status).toBe(400)
    expect((await apiJson('PATCH', '/api/settings', { logoDataUrl: '' })).status).toBe(200)
    expect((await apiJson<{ logo: string | null }>('GET', '/api/auth/users')).body.logo).toBeNull()
  })
})
