import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { cashMovementSchema } from '@/lib/finance'
import { addCashMovement } from '@/server/services/finance'

/** POST: put cash into the drawer or take it out (bank deposit, owner withdrawal, float). */
export const POST = route(async (req) => {
  const actor = await requireActor('cash.manage')
  const input = await readBody(req, cashMovementSchema)
  return json(await addCashMovement(await getDb(), actor, input), { status: 201 })
})
