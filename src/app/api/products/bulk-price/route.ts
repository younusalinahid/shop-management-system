import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { bulkPriceSchema } from '@/lib/product'
import { bulkUpdatePrices } from '@/server/services/product'

export const POST = route(async (req) => {
  const actor = await requireActor('products.edit', 'products.edit_price')
  const input = await readBody(req, bulkPriceSchema)
  return json({ changed: await bulkUpdatePrices(await getDb(), actor, input) })
})
