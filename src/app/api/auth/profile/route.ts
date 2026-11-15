import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { ownProfileSchema, updateOwnProfile } from '@/server/services/users'

/** PATCH: change your own name and profile picture. Any signed-in user. */
export const PATCH = route(async (req) => {
  const actor = await requireActor()
  const body = await readBody(req, ownProfileSchema)
  return json({ user: await updateOwnProfile(await getDb(), actor, body) })
})
