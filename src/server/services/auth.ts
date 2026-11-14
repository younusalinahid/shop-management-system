import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { User, UserRole } from '@/types/db'
import { BusinessError } from '@/lib/errors'
import type { Db } from '../db'
import { users } from '../db/schema'
import { type Actor, assertCan, SYSTEM_ACTOR, writeAudit } from './audit'

/**
 * Users and PIN login. PINs are stored as PBKDF2-SHA256 hashes with a per-user salt.
 * The session cookie is issued by server/auth/session.ts after a successful login.
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
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256)
  return { hash: toHex(bits), salt: toHex(salt) }
}

/** Constant-time comparison so response timing doesn't reveal how much of a hash matched. */
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

export const pinSchema = z.string().min(4, 'v.pinMin').max(32, 'v.pinMax')

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'v.usernameMin')
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'v.usernameChars')

export const newUserSchema = z.object({
  name: z.string().trim().min(1, 'v.nameRequired').max(80),
  username: usernameSchema,
  role: z.enum(['owner', 'manager', 'cashier']),
  pin: pinSchema,
})
export type NewUserInput = z.input<typeof newUserSchema>

export type PublicUser = Pick<User, 'id' | 'name' | 'username' | 'role'>
const toPublic = (u: PublicUser): PublicUser => ({ id: u.id, name: u.name, username: u.username, role: u.role })

export async function hasAnyUser(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users)
  return row.n > 0
}

async function insertUser(db: Db, actor: Actor, input: NewUserInput): Promise<PublicUser> {
  const data = newUserSchema.parse(input)
  // Hash before the transaction: it is slow on purpose and must not hold the transaction open.
  const { hash, salt } = await hashPin(data.pin)
  const now = Date.now()
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.username, data.username))
    if (existing) throw new BusinessError('duplicate_username', 'That username is already in use.')
    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        username: data.username,
        role: data.role as UserRole,
        pinHash: hash,
        pinSalt: salt,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await writeAudit(tx, actor, { action: 'user.create', module: 'users', entityId: user.id, after: toPublic(user) })
    return toPublic(user)
  })
}

/** First-run setup: creates the owner account. Refuses if any user already exists. */
export async function createInitialOwner(db: Db, input: Omit<NewUserInput, 'role'>): Promise<PublicUser> {
  if (await hasAnyUser(db)) throw new BusinessError('already_setup', 'The shop is already set up.')
  return insertUser(db, SYSTEM_ACTOR, { ...input, role: 'owner' })
}

export async function createUser(db: Db, actor: Actor, input: NewUserInput): Promise<PublicUser> {
  assertCan(actor, 'users.manage')
  return insertUser(db, actor, input)
}

/** Check username + PIN. Returns the user; the caller starts the session. */
export async function login(db: Db, username: string, pin: string): Promise<PublicUser> {
  const uname = username.trim().toLowerCase()
  const [user] = await db.select().from(users).where(eq(users.username, uname))
  // Same message for unknown user and wrong PIN.
  const fail = new BusinessError('invalid_login', 'Incorrect username or PIN.')
  if (!user) {
    await hashPin(pin) // keep timing similar to a real check
    throw fail
  }
  if (user.status !== 'active') throw new BusinessError('inactive', 'This user account is disabled.')
  if (!(await verifyPin(user, pin))) throw fail
  const now = Date.now()
  await db.transaction(async (tx) => {
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id))
    await writeAudit(tx, { id: user.id, name: user.name, role: user.role }, { action: 'user.login', module: 'auth', entityId: user.id })
  })
  return toPublic(user)
}

/**
 * Public demo account (a Manager, so visitors can look around but not touch users, settings or backups).
 * Its credentials are shown on the login screen, but only while an active user with this username exists.
 * Create it with `node scripts/seed-demo.mjs`; disable or delete that user to hide the card.
 */
export const DEMO_USERNAME = 'younus ali nahid'
export const DEMO_PASSWORD = '12345'

export async function getDemoLogin(db: Db): Promise<{ username: string; password: string } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, DEMO_USERNAME), eq(users.status, 'active'), eq(users.role, 'manager')))
  return row ? { username: DEMO_USERNAME, password: DEMO_PASSWORD } : null
}
