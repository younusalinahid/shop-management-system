import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError, type z, type ZodTypeAny } from 'zod'
import { BusinessError, statusForCode } from '@/lib/errors'
import { type Permission } from '@/lib/permissions'
import { type SessionUser, getSessionUser } from './auth/session'
import { translateMessage } from '@/i18n/translate'
import { getServerT } from './i18n'
import { assertCan, type Actor } from './services/audit'

/**
 * Shared Route Handler plumbing: JSON parsing, auth, and one error format.
 * Every error response is `{ error: { code, message, issues? } }` with a matching HTTP status.
 */

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/** Error message in the request's language; falls back to the English text when no translation exists. */
export async function errorResponse(err: unknown) {
  const t = await getServerT()
  const tr = (key: string, fallback: string, values?: Record<string, string | number>) => (t.has(key) ? t(key, values) : fallback)
  if (err instanceof BusinessError) {
    return json({ error: { code: err.code, message: tr(`errors.${err.key}`, err.message, err.values) } }, { status: statusForCode(err.code) })
  }
  if (err instanceof ZodError) {
    // Schema messages are keys ("v.nameRequired"), shared with the forms; see src/i18n/translate.ts.
    const issue = (i: (typeof err.issues)[number]) => translateMessage(t, i.message, (i as { params?: Record<string, string | number> }).params)
    const first = err.issues[0]
    return json(
      {
        error: {
          code: 'invalid',
          message: first ? issue(first) : tr('errors.invalid', 'Invalid input'),
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: issue(i) })),
        },
      },
      { status: 400 },
    )
  }
  // Postgres unique violation (both postgres.js and PGlite expose the SQLSTATE as `code`).
  const pgCode = (err as { code?: unknown; cause?: { code?: unknown } })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code
  if (pgCode === '23505') {
    return json({ error: { code: 'duplicate', message: tr('errors.duplicate', 'A record with the same unique value already exists.') } }, { status: 409 })
  }
  console.error(err)
  return json({ error: { code: 'server_error', message: tr('errors.server_error', 'Something went wrong on the server.') } }, { status: 500 })
}

/** Parse a JSON body with a Zod schema (400 on failure). */
export async function readBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new BusinessError('invalid', 'Request body must be JSON.', { key: 'invalidJson' })
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
      return await errorResponse(err)
    }
  }
}
