import { describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { ensureDefaults } from '@/db/bootstrap'
import { createInitialOwner, createUser, hashPin, login, verifyPin } from '@/services/auth-service'
import { BusinessError } from '@/services/errors'
import { getSettings, updateSettings } from '@/services/settings-service'

describe('auth-service', () => {
  it('hashes PINs with a random salt and verifies them', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPin({ pinHash: a.hash, pinSalt: a.salt }, '1234')).toBe(true)
    expect(await verifyPin({ pinHash: a.hash, pinSalt: a.salt }, '4321')).toBe(false)
  })

  it('creates the owner once and never stores the plain PIN', async () => {
    const owner = await createInitialOwner({ name: 'Karim', username: 'Owner', pin: '2468' })
    expect(owner.role).toBe('owner')
    expect(owner.username).toBe('owner')
    const stored = await db.users.get(owner.id)
    expect(JSON.stringify(stored)).not.toContain('2468')
    await expect(createInitialOwner({ name: 'X', username: 'x', pin: '0000' })).rejects.toBeInstanceOf(BusinessError)
    expect(await db.auditLogs.where('action').equals('user.create').count()).toBe(1)
  })

  it('logs in with the right PIN only', async () => {
    const owner = await createInitialOwner({ name: 'Karim', username: 'owner', pin: '2468' })
    await expect(login('owner', '0000')).rejects.toThrow('Incorrect username or PIN.')
    await expect(login('nobody', '2468')).rejects.toThrow('Incorrect username or PIN.')
    const u = await login(' OWNER ', '2468')
    expect(u.id).toBe(owner.id)
    expect(u.lastLoginAt).toBeTypeOf('number')
  })

  it('rejects duplicate usernames and short PINs', async () => {
    const owner = await createInitialOwner({ name: 'Karim', username: 'owner', pin: '2468' })
    const actor = { id: owner.id, name: owner.name }
    await createUser(actor, { name: 'Rafi', username: 'rafi', role: 'cashier', pin: '1111' })
    await expect(createUser(actor, { name: 'Rafi 2', username: 'rafi', role: 'cashier', pin: '1111' })).rejects.toThrow('already in use')
    await expect(createUser(actor, { name: 'Z', username: 'z1', role: 'cashier', pin: '12' })).rejects.toThrow()
  })

  it('blocks disabled users', async () => {
    const owner = await createInitialOwner({ name: 'Karim', username: 'owner', pin: '2468' })
    await db.users.update(owner.id, { status: 'archived' })
    await expect(login('owner', '2468')).rejects.toThrow('disabled')
  })
})

describe('settings-service', () => {
  const actor = { id: 'u1', name: 'Karim' }

  it('returns defaults merged with stored values', async () => {
    await ensureDefaults()
    const s = await getSettings()
    expect(s.currency).toBe('BDT')
    expect(s.timezone).toBe('Asia/Dhaka')
    expect(s.allowNegativeStock).toBe(false)
  })

  it('updates settings and audits only changed fields', async () => {
    await ensureDefaults()
    await updateSettings(actor, { shopName: 'Rahman Store', invoicePrefix: 'INV-' })
    expect((await getSettings()).shopName).toBe('Rahman Store')
    const logs = await db.auditLogs.where('module').equals('settings').toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0].after).toEqual({ shopName: 'Rahman Store' })
    expect(logs[0].before).toEqual({ shopName: 'My Shop' })
  })

  it('skips the write and audit when nothing changed', async () => {
    await ensureDefaults()
    await updateSettings(actor, { shopName: 'My Shop' })
    expect(await db.auditLogs.count()).toBe(0)
  })
})
