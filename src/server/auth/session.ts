import 'server-only'
import { and, eq, gt } from 'drizzle-orm'
import { cookies } from 'next/headers'
import type { UserRole } from '@/types/db'
import { getDb, type Db } from '../db'
import { sessions, users } from '../db/schema'

/**
 * Cookie sessions. The browser holds a random token in an httpOnly cookie; the database stores
 * only its SHA-256, so reading the sessions table does not let anyone sign in.
 */

export const SESSION_COOKIE = 'pos_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // one long shop day

export interface SessionUser {
  id: string
  name: string
  username: string
  role: UserRole
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}

/** Create a session row and set the cookie. Call from a Route Handler. */
export async function startSession(db: Db, userId: string): Promise<void> {
  const token = newToken()
  const now = Date.now()
  await db.insert(sessions).values({ id: await sha256Hex(token), userId, expiresAt: now + SESSION_TTL_MS, createdAt: now })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

/** The signed-in, active user for this request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const db = await getDb()
  const [row] = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, await sha256Hex(token)), gt(sessions.expiresAt, Date.now()), eq(users.status, 'active')))
  return row ?? null
}

/** Delete the session row and clear the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    const db = await getDb()
    await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)))
  }
  jar.delete(SESSION_COOKIE)
}
