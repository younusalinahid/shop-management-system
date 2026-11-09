import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { can } from '@/lib/permissions'
import { productInputSchema } from '@/lib/product'
import { createProduct, getCatalog } from '@/server/services/product'

/** GET: the whole catalog (products, units, barcodes, categories, brands) for lists and pickers. */
export const GET = route(async () => {
  const actor = await requireActor('products.view')
  return json(await getCatalog(await getDb(), { includeCost: can(actor.role, 'products.view_cost') }))
})

export const POST = route(async (req) => {
  const actor = await requireActor('products.edit')
  const input = await readBody(req, productInputSchema)
  return json(await createProduct(await getDb(), actor, input), { status: 201 })
})
