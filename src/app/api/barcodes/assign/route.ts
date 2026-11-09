import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { assignGeneratedBarcodes } from '@/server/services/product'

/** POST { productIds } → gives each product without a barcode a generated one. */
export const POST = route(async (req) => {
  const actor = await requireActor('products.edit')
  const { productIds } = await readBody(req, z.object({ productIds: z.array(z.string().uuid()).min(1).max(5000) }))
  return json({ added: await assignGeneratedBarcodes(await getDb(), actor, productIds) })
})
