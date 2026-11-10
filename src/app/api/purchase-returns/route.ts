import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { purchaseReturnSchema } from '@/lib/parties'
import { createPurchaseReturn, listPurchaseReturns } from '@/server/services/returns'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({
  q: z.string().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  docId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})
const paramsOf = (req: Request) => Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))

export const GET = route(async (req) => {
  await requireActor('purchases.manage')
  return json(await listPurchaseReturns(await getDb(), query.parse(paramsOf(req))))
})

/** POST: send items of a purchase back to the supplier. Stock leaves from the purchase's batch. */
export const POST = route(async (req) => {
  const actor = await requireActor('purchases.manage')
  const input = await readBody(req, purchaseReturnSchema)
  return json(await createPurchaseReturn(await getDb(), actor, input), { status: 201 })
})
