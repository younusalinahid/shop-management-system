import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { partyPaymentSchema } from '@/lib/parties'
import { collectDue } from '@/server/services/payment'

/** POST: collect money a customer owes. */
export const POST = route(async (req) => {
  const actor = await requireActor('payments.manage')
  const input = await readBody(req, partyPaymentSchema)
  return json(await collectDue(await getDb(), actor, input), { status: 201 })
})
