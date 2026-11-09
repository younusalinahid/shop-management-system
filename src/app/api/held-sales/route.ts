import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { holdSchema } from '@/lib/sales'
import { holdSale, listHeld } from '@/server/services/sale'

export const GET = route(async () => {
  await requireActor('pos.sell')
  return json({ items: await listHeld(await getDb()) })
})

export const POST = route(async (req) => {
  const actor = await requireActor('pos.sell')
  const input = await readBody(req, holdSchema)
  return json(await holdSale(await getDb(), actor, input), { status: 201 })
})
