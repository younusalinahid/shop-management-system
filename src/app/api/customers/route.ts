import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { customerSchema } from '@/lib/sales'
import { createCustomer, listCustomers } from '@/server/services/customer'

export const GET = route(async () => {
  await requireActor('parties.view')
  return json({ items: await listCustomers(await getDb()) })
})

export const POST = route(async (req) => {
  const actor = await requireActor('pos.sell')
  const input = await readBody(req, customerSchema)
  return json(await createCustomer(await getDb(), actor, input), { status: 201 })
})
