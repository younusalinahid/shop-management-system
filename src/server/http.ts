import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError, type z, type ZodTypeAny } from 'zod'
import { BusinessError, statusForCode } from '@/lib/errors'
import { type Permission } from '@/lib/permissions'
import { type SessionUser, getSessionUser } from './auth/session'
import { assertCan, type Actor } from './services/audit'

/**
 * Shared Route Handler plumbing: JSON parsing, auth, and one error format.
 * Every error response is `{ error: { code, message, issues? } }` with a matching HTTP status.
 */

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function errorResponse(err: unknown) {
  if (err instanceof BusinessError) {
    return json({ error: { code: err.code, message: err.message } }, { status: statusForCode(err.code) })
  }
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return json(
      { error: { code: 'invalid', message: first?.message ?? 'Invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
      { status: 400 },
    )
  }
  // Postgres unique violation (both postgres.js and PGlite expose the SQLSTATE as `code`).
  const pgCode = (err as { code?: unknown; cause?: { code?: unknown } })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code
  if (pgCode === '23505') {
    return json({ error: { code: 'duplicate', message: 'A record with the same unique value already exists.' } }, { status: 409 })
  }
  console.error(err)
  return json({ error: { code: 'server_error', message: 'Something went wrong on the server.' } }, { status: 500 })
}

/** Parse a JSON body with a Zod schema (400 on failure). */
export async function readBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new BusinessError('invalid', 'Request body must be JSON.')
  }
  return schema.parse(body)
}

/** The signed-in user as an audit actor, checking permissions. Throws 401/403 as BusinessError. */
export async function requireActor(...permissions: Permission[]): Promise<Actor & { user: SessionUser }> {
  const user = await getSessionUser()
  if (!user) throw new BusinessError('unauthorized', 'Please sign in again.')
  const actor = { id: user.id, name: user.name, role: user.role }
  assertCan(actor, ...permissions)
  return { ...actor, user }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>

/** Wrap a Route Handler so thrown errors become JSON error responses. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      return errorResponse(err)
    }
  }
}
