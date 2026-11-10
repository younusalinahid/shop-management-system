import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { saleReturnSchema } from '@/lib/parties'
import { createSaleReturn, listSaleReturns } from '@/server/services/returns'

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
  await requireActor('sales.view')
  return json(await listSaleReturns(await getDb(), query.parse(paramsOf(req))))
})

/** POST: return items from an invoice. Resalable goods go back into stock. */
export const POST = route(async (req) => {
  const actor = await requireActor('returns.process')
  const input = await readBody(req, saleReturnSchema)
  return json(await createSaleReturn(await getDb(), actor, input), { status: 201 })
})
