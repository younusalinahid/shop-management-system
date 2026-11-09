import { z } from 'zod'
import { db } from '@/db/database'
import type { User, UserRole } from '@/types/db'
import { newId } from '@/lib/id'
import { type Actor, SYSTEM_ACTOR, writeAudit } from './audit-service'
import { BusinessError } from './errors'

/**
 * LOCAL AUTHENTICATION — IMPORTANT LIMITATION
 * Users and PIN hashes live in this browser's IndexedDB. Anyone with access to the
 * device and browser dev tools can read or modify the data. PIN login is a convenience
 * for separating cashier/manager roles at the counter, not server-grade security.
 */

const PBKDF2_ITERATIONS = 150_000

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  )
  return { hash: toHex(bits), salt: toHex(salt) }
}

/** Constant-time-ish comparison to avoid trivially leaking match length. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPin(user: Pick<User, 'pinHash' | 'pinSalt'>, pin: string): Promise<boolean> {
  const { hash } = await hashPin(pin, user.pinSalt)
  return safeEqual(hash, user.pinHash)
}

export const pinSchema = z
  .string()
  .min(4, 'PIN must be at least 4 characters')
  .max(32, 'PIN is too long')

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Username must be at least 2 characters')
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore')

export const newUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: usernameSchema,
  role: z.enum(['owner', 'manager', 'cashier']),
  pin: pinSchema,
})
export type NewUserInput = z.infer<typeof newUserSchema>

export async function hasAnyUser(): Promise<boolean> {
  return (await db.users.count()) > 0
}

async function insertUser(actor: Actor, input: NewUserInput): Promise<User> {
  const data = newUserSchema.parse(input)
  const existing = await db.users.where('username').equals(data.username).first()
  if (existing) throw new BusinessError('username_taken', 'That username is already in use.')
  const { hash, salt } = await hashPin(data.pin)
  const now = Date.now()
  const user: User = {
    id: newId(),
    name: data.name,
    username: data.username,
    role: data.role as UserRole,
    pinHash: hash,
    pinSalt: salt,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.users, db.auditLogs, async () => {
    await db.users.add(user)
    await writeAudit(actor, {
      action: 'user.create',
      module: 'users',
      entityId: user.id,
      after: { name: user.name, username: user.username, role: user.role },
    })
  })
  return user
}

/** First-run setup: creates the owner account. Refuses if any user already exists. */
export async function createInitialOwner(input: Omit<NewUserInput, 'role'>): Promise<User> {
  if (await hasAnyUser()) throw new BusinessError('already_setup', 'The shop is already set up.')
  return insertUser(SYSTEM_ACTOR, { ...input, role: 'owner' })
}

export async function createUser(actor: Actor, input: NewUserInput): Promise<User> {
  return insertUser(actor, input)
}

export async function login(username: string, pin: string): Promise<User> {
  const uname = username.trim().toLowerCase()
  const user = await db.users.where('username').equals(uname).first()
  // Same message for unknown user and wrong PIN.
  const fail = new BusinessError('invalid_login', 'Incorrect username or PIN.')
  if (!user) throw fail
  if (user.status !== 'active') throw new BusinessError('inactive', 'This user account is disabled.')
  if (!(await verifyPin(user, pin))) throw fail
  const now = Date.now()
  await db.transaction('rw', db.users, db.auditLogs, async () => {
    await db.users.update(user.id, { lastLoginAt: now })
    await writeAudit({ id: user.id, name: user.name }, { action: 'user.login', module: 'auth', entityId: user.id })
  })
  return { ...user, lastLoginAt: now }
}

export async function listActiveUsers(): Promise<Array<Pick<User, 'id' | 'name' | 'username' | 'role'>>> {
  const users = await db.users.where('status').equals('active').sortBy('name')
  return users.map(({ id, name, username, role }) => ({ id, name, username, role }))
}
