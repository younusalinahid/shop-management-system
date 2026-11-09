import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { can } from '@/lib/permissions'
import { saleInputSchema } from '@/lib/sales'
import { createSale, listSales } from '@/server/services/sale'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['completed', 'partially_returned', 'returned', 'cancelled']).optional(),
  customerId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

/** GET: sales history, newest first, filtered and paginated on the server. */
export const GET = route(async (req) => {
  const actor = await requireActor('sales.view')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  const page = await listSales(await getDb(), query.parse(params))
  if (!can(actor.role, 'products.view_cost')) page.items = page.items.map((s) => ({ ...s, cogs: 0 }))
  return json(page)
})

/** POST: complete a sale. Stock goes down in the same transaction. Retrying with the same idempotencyKey is safe. */
export const POST = route(async (req) => {
  const actor = await requireActor('pos.sell')
  const input = await readBody(req, saleInputSchema)
  return json(await createSale(await getDb(), actor, input), { status: 201 })
})
