import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { listPayments } from '@/server/services/payment'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({
  partyType: z.enum(['customer', 'supplier']).optional(),
  partyId: z.string().uuid().optional(),
  kind: z.enum(['due_collection', 'supplier_payment', 'customer_refund', 'supplier_refund']).optional(),
  q: z.string().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

/** GET: due collections and supplier payments, newest first. */
export const GET = route(async (req) => {
  await requireActor('payments.manage')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  return json(await listPayments(await getDb(), query.parse(params)))
})
