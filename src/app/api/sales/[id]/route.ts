import { z } from 'zod'
import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import { json, requireActor, route } from '@/server/http'
import { getSale } from '@/server/services/sale'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const actor = await requireActor('sales.view')
  const sale = await getSale(await getDb(), z.string().uuid('v.invalidId').parse((await params).id))
  if (!sale) throw new BusinessError('not_found', 'Sale not found.', { key: 'saleNotFound' })
  if (can(actor.role, 'products.view_cost')) return json(sale)
  return json({ ...sale, cogs: 0, items: sale.items.map((i) => ({ ...i, costTotal: 0 })) })
})
