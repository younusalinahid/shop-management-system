import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { cancelSchema } from '@/lib/inventory'
import { cancelPurchase } from '@/server/services/purchase'

type Ctx = { params: Promise<{ id: string }> }

/** POST: cancel with a reason. Stock is taken back out with reversing movements; nothing is deleted. */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('purchases.manage')
  const body = await readBody(req, cancelSchema)
  return json(await cancelPurchase(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body))
})
