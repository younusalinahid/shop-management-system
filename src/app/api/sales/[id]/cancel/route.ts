import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { cancelSchema } from '@/lib/inventory'
import { cancelSale } from '@/server/services/sale'

type Ctx = { params: Promise<{ id: string }> }

/** POST: cancel with a reason. Stock goes back with reversing movements; nothing is deleted. */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('sales.cancel')
  const body = await readBody(req, cancelSchema)
  return json(await cancelSale(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body))
})
