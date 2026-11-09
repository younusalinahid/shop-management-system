import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { can } from '@/lib/permissions'
import { listMovements } from '@/server/services/inventory'

const query = z.object({
  productId: z.string().uuid().optional(),
  type: z.string().max(40).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

/** GET: stock movement history, newest first, filtered and paginated on the server. */
export const GET = route(async (req) => {
  const actor = await requireActor('inventory.view')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  const f = query.parse(params)
  const page = await listMovements(await getDb(), { ...f, type: f.type as never })
  if (!can(actor.role, 'products.view_cost')) page.items = page.items.map((m) => ({ ...m, valueChange: 0 }))
  return json(page)
})
