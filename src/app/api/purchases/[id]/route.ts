import { z } from 'zod'
import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { json, requireActor, route } from '@/server/http'
import { getPurchase } from '@/server/services/purchase'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  await requireActor('purchases.manage')
  const purchase = await getPurchase(await getDb(), z.string().uuid('v.invalidId').parse((await params).id))
  if (!purchase) throw new BusinessError('not_found', 'Purchase not found.', { key: 'purchaseNotFound' })
  return json(purchase)
})
