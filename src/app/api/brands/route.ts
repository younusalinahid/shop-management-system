import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { catalogEntrySchema } from '@/lib/catalog'
import { createBrand, listBrands, productCountsBy } from '@/server/services/catalog'

/** GET: every brand (any status) with the number of products using it. */
export const GET = route(async () => {
  await requireActor('products.view')
  const db = await getDb()
  const [items, productCounts] = await Promise.all([listBrands(db), productCountsBy(db, 'brandId')])
  return json({ items, productCounts })
})

export const POST = route(async (req) => {
  const actor = await requireActor('products.edit')
  const input = await readBody(req, catalogEntrySchema)
  return json(await createBrand(await getDb(), actor, input), { status: 201 })
})
