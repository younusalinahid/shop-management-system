import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { createUser, newUserSchema } from '@/server/services/auth'
import { listUsers } from '@/server/services/users'

/** GET: every user (owner only). POST: add a user with a role and a PIN. */
export const GET = route(async () => {
  const actor = await requireActor('users.manage')
  return json({ items: await listUsers(await getDb(), actor) })
})

export const POST = route(async (req) => {
  const actor = await requireActor('users.manage')
  const input = await readBody(req, newUserSchema)
  return json(await createUser(await getDb(), actor, input), { status: 201 })
})
