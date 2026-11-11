import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import type { UserRole } from '@/types/db'
import { BusinessError } from '@/lib/errors'
import type { Db } from '../db'
import { sessions, users } from '../db/schema'
import { type Actor, assertCan, writeAudit } from './audit'
import { hashPin, pinSchema, verifyPin } from './auth'

/**
 * User management (owner only) and changing your own PIN. The shop always keeps at least one active
 * owner. Disabling a user or resetting their PIN signs them out everywhere.
 */

export interface UserRecord {
  id: string
  name: string
  username: string
  role: UserRole
  status: 'active' | 'archived'
  lastLoginAt?: number
  createdAt: number
}

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'v.nameRequired').max(80),
  role: z.enum(['owner', 'manager', 'cashier']),
})
export const resetPinSchema = z.object({ pin: pinSchema })
export const changePinSchema = z.object({ currentPin: z.string().min(1, 'v.required'), newPin: pinSchema })

type Row = typeof users.$inferSelect
const toRecord = (u: Row): UserRecord => ({ id: u.id, name: u.name, username: u.username, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt ?? undefined, createdAt: u.createdAt })

export async function listUsers(db: Db, actor: Actor): Promise<UserRecord[]> {
  assertCan(actor, 'users.manage')
  return (await db.select().from(users).orderBy(asc(users.status), asc(users.name))).map(toRecord)
}

async function lockUser(tx: Db, id: string) {
  const [u] = await tx.select().from(users).where(eq(users.id, id)).for('update')
  if (!u) throw new BusinessError('not_found', 'User not found.', { key: 'userNotFound' })
  return u
}

/** Throw if `id` is the only active owner and the change would remove that. */
async function assertAnotherOwner(tx: Db, id: string) {
  const others = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'owner'), eq(users.status, 'active'), ne(users.id, id)))
  if (others.length === 0) throw new BusinessError('last_owner', 'The shop needs at least one active owner.')
}

export async function updateUser(db: Db, actor: Actor, id: string, input: z.input<typeof updateUserSchema>): Promise<UserRecord> {
  assertCan(actor, 'users.manage')
  const data = updateUserSchema.parse(input)
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, id)
    if (u.role === 'owner' && data.role !== 'owner' && u.status === 'active') await assertAnotherOwner(tx, id)
    const now = Date.now()
    const [row] = await tx.update(users).set({ name: data.name, role: data.role, updatedAt: now }).where(eq(users.id, id)).returning()
    if (u.role !== data.role || u.name !== data.name) {
      await writeAudit(tx, actor, { action: u.role !== data.role ? 'user.role_change' : 'user.update', module: 'users', entityId: id, before: { name: u.name, role: u.role }, after: data })
    }
    return toRecord(row)
  })
}

export async function setUserStatus(db: Db, actor: Actor, id: string, status: 'active' | 'archived'): Promise<UserRecord> {
  assertCan(actor, 'users.manage')
  if (id === actor.id && status === 'archived') throw new BusinessError('conflict', 'You cannot disable your own account.', { key: 'disableSelf' })
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, id)
    if (u.status === status) return toRecord(u)
    if (status === 'archived' && u.role === 'owner') await assertAnotherOwner(tx, id)
    const [row] = await tx.update(users).set({ status, updatedAt: Date.now() }).where(eq(users.id, id)).returning()
    if (status === 'archived') await tx.delete(sessions).where(eq(sessions.userId, id))
    await writeAudit(tx, actor, { action: status === 'archived' ? 'user.disable' : 'user.enable', module: 'users', entityId: id, before: { status: u.status }, after: { status } })
    return toRecord(row)
  })
}

/** Owner sets a new PIN for someone (forgotten PIN). Their other sessions end. */
export async function resetPin(db: Db, actor: Actor, id: string, input: { pin: string }): Promise<void> {
  assertCan(actor, 'users.manage')
  const { pin } = resetPinSchema.parse(input)
  const { hash, salt } = await hashPin(pin)
  await db.transaction(async (tx) => {
    await lockUser(tx, id)
    await tx.update(users).set({ pinHash: hash, pinSalt: salt, updatedAt: Date.now() }).where(eq(users.id, id))
    if (id !== actor.id) await tx.delete(sessions).where(eq(sessions.userId, id))
    await writeAudit(tx, actor, { action: 'user.pin_reset', module: 'users', entityId: id })
  })
}

/** Any user changes their own PIN after confirming the current one. */
export async function changeOwnPin(db: Db, actor: Actor, input: { currentPin: string; newPin: string }): Promise<void> {
  const data = changePinSchema.parse(input)
  const [u] = await db.select().from(users).where(eq(users.id, actor.id))
  if (!u) throw new BusinessError('not_found', 'User not found.', { key: 'userNotFound' })
  if (!(await verifyPin(u, data.currentPin))) throw new BusinessError('invalid_login', 'The current PIN is wrong.', { key: 'wrongPin' })
  const { hash, salt } = await hashPin(data.newPin)
  await db.transaction(async (tx) => {
    await tx.update(users).set({ pinHash: hash, pinSalt: salt, updatedAt: Date.now() }).where(eq(users.id, actor.id))
    await writeAudit(tx, actor, { action: 'user.pin_change', module: 'users', entityId: actor.id })
  })
}
