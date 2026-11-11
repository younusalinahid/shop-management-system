import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { changeOwnPin, changePinSchema } from '@/server/services/users'

/** POST: change your own PIN (needs the current one). */
export const POST = route(async (req) => {
  const actor = await requireActor()
  const body = await readBody(req, changePinSchema)
  await changeOwnPin(await getDb(), actor, body)
  return json({ ok: true })
})
