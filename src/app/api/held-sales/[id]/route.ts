import { z } from 'zod'
import { getDb } from '@/server/db'
import { requireActor, route } from '@/server/http'
import { deleteHeld } from '@/server/services/sale'

type Ctx = { params: Promise<{ id: string }> }

/** DELETE: the held cart was resumed or discarded. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const actor = await requireActor('pos.sell')
  await deleteHeld(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id))
  return new Response(null, { status: 204 })
})
