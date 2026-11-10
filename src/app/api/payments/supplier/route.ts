import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { partyPaymentSchema } from '@/lib/parties'
import { paySupplier } from '@/server/services/payment'

/** POST: pay money the shop owes a supplier. */
export const POST = route(async (req) => {
  const actor = await requireActor('purchases.manage')
  const input = await readBody(req, partyPaymentSchema)
  return json(await paySupplier(await getDb(), actor, input), { status: 201 })
})
