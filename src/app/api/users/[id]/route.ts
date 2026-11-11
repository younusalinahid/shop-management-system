import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { setUserStatus, updateUser, updateUserSchema } from '@/server/services/users'

type Ctx = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid('v.invalidId')

/** PUT: name and role. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('users.manage')
  const input = await readBody(req, updateUserSchema)
  return json(await updateUser(await getDb(), actor, idSchema.parse((await params).id), input))
})

/** PATCH: disable or enable. A disabled user is signed out everywhere. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('users.manage')
  const body = await readBody(req, z.object({ status: z.enum(['active', 'archived']) }))
  return json(await setUserStatus(await getDb(), actor, idSchema.parse((await params).id), body.status))
})
