// @vitest-environment node
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { BusinessError } from '@/lib/errors'
import { getDb } from '@/server/db'
import { auditLogs, users } from '@/server/db/schema'
import { type Actor, SYSTEM_ACTOR } from '@/server/services/audit'
import { createInitialOwner, createUser, hashPin, login, verifyPin } from '@/server/services/auth'
import { nextCounter } from '@/server/services/counter'
import { getSettings, updateSettings } from '@/server/services/settings'

describe('auth service', () => {
  it('hashes PINs with a random salt and verifies them', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPin({ pinHash: a.hash, pinSalt: a.salt }, '1234')).toBe(true)
    expect(await verifyPin({ pinHash: a.hash, pinSalt: a.salt }, '4321')).toBe(false)
  })

  it('creates the owner once and never stores the plain PIN', async () => {
    const db = await getDb()
    const owner = await createInitialOwner(db, { name: 'Karim', username: 'Owner', pin: '2468' })
    expect(owner.role).toBe('owner')
    expect(owner.username).toBe('owner')
    const [stored] = await db.select().from(users).where(eq(users.id, owner.id))
    expect(JSON.stringify(stored)).not.toContain('2468')
    await expect(createInitialOwner(db, { name: 'X', username: 'x', pin: '0000' })).rejects.toBeInstanceOf(BusinessError)
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'user.create'))).toHaveLength(1)
  })

  it('logs in with the right PIN only', async () => {
    const db = await getDb()
    const owner = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
    await expect(login(db, 'owner', '0000')).rejects.toThrow('Incorrect username or PIN.')
    await expect(login(db, 'nobody', '2468')).rejects.toThrow('Incorrect username or PIN.')
    const u = await login(db, ' OWNER ', '2468')
    expect(u.id).toBe(owner.id)
    const [row] = await db.select().from(users).where(eq(users.id, owner.id))
    expect(row.lastLoginAt).toBeTypeOf('number')
  })

  it('rejects duplicate usernames and short PINs; only owners create users', async () => {
    const db = await getDb()
    const o = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
    const actor: Actor = { id: o.id, name: o.name, role: 'owner' }
    const rafi = await createUser(db, actor, { name: 'Rafi', username: 'rafi', role: 'cashier', pin: '1111' })
    await expect(createUser(db, actor, { name: 'Rafi 2', username: 'rafi', role: 'cashier', pin: '1111' })).rejects.toThrow('already in use')
    await expect(createUser(db, actor, { name: 'Z', username: 'z1', role: 'cashier', pin: '12' })).rejects.toThrow()
    await expect(createUser(db, { id: rafi.id, name: 'Rafi', role: 'cashier' }, { name: 'Y', username: 'y1', role: 'owner', pin: '1234' })).rejects.toThrow(
      'permission',
    )
  })

  it('blocks disabled users', async () => {
    const db = await getDb()
    const owner = await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })
    await db.update(users).set({ status: 'archived' }).where(eq(users.id, owner.id))
    await expect(login(db, 'owner', '2468')).rejects.toThrow('disabled')
  })
})

describe('settings service', () => {
  it('returns defaults when nothing is stored', async () => {
    const s = await getSettings(await getDb())
    expect(s.currency).toBe('BDT')
    expect(s.timezone).toBe('Asia/Dhaka')
    expect(s.allowNegativeStock).toBe(false)
    expect(s.updatedAt).toBe(0)
  })

  it('updates settings and audits only changed fields', async () => {
    const db = await getDb()
    await updateSettings(db, SYSTEM_ACTOR, { shopName: 'Rahman Store', invoicePrefix: 'INV-' })
    expect((await getSettings(db)).shopName).toBe('Rahman Store')
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.module, 'settings'))
    expect(logs).toHaveLength(1)
    expect(logs[0].after).toEqual({ shopName: 'Rahman Store' })
    expect(logs[0].before).toEqual({ shopName: 'My Shop' })
  })

  it('skips the write and audit when nothing changed, and rejects unknown fields', async () => {
    const db = await getDb()
    await updateSettings(db, SYSTEM_ACTOR, { shopName: 'My Shop' })
    expect(await db.select().from(auditLogs)).toHaveLength(0)
    await expect(updateSettings(db, SYSTEM_ACTOR, { currency: 'USD' } as never)).rejects.toThrow()
    await expect(updateSettings(db, { id: 'c', name: 'C', role: 'cashier' }, { shopName: 'X' })).rejects.toThrow('permission')
  })
})

describe('counters', () => {
  it('increments atomically, even when called concurrently', async () => {
    const db = await getDb()
    const values = await Promise.all(Array.from({ length: 10 }, () => nextCounter(db, 'product')))
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
