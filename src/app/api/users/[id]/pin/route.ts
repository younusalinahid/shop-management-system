import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { resetPin, resetPinSchema } from '@/server/services/users'

type Ctx = { params: Promise<{ id: string }> }

/** POST: set a new PIN for a user who forgot theirs. */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('users.manage')
  const body = await readBody(req, resetPinSchema)
  await resetPin(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body)
  return json({ ok: true })
})
