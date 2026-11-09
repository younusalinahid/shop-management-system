import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { purchaseInputSchema } from '@/lib/inventory'
import { createPurchase, listPurchases } from '@/server/services/purchase'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['completed', 'partially_returned', 'returned', 'cancelled']).optional(),
  supplierId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

/** GET: purchase history, newest first, filtered and paginated on the server. */
export const GET = route(async (req) => {
  await requireActor('purchases.manage')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  return json(await listPurchases(await getDb(), query.parse(params)))
})

/** POST: save a purchase. Stock goes up in the same transaction. Retrying with the same idempotencyKey is safe. */
export const POST = route(async (req) => {
  const actor = await requireActor('purchases.manage')
  const input = await readBody(req, purchaseInputSchema)
  return json(await createPurchase(await getDb(), actor, input), { status: 201 })
})
