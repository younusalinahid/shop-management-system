import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { adjustmentSchema } from '@/lib/inventory'
import { adjustStock } from '@/server/services/inventory'

/** POST: opening stock, a correction, or a write-off (damaged, lost, expired). */
export const POST = route(async (req) => {
  const actor = await requireActor('inventory.adjust')
  const input = await readBody(req, adjustmentSchema)
  const product = await adjustStock(await getDb(), actor, input)
  return json({ id: product.id, stockQty: product.stockQty })
})
