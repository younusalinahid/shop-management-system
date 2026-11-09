import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { catalogEntrySchema } from '@/lib/catalog'
import { createCategory, listCategories, productCountsBy } from '@/server/services/catalog'

/** GET: every category (any status) with the number of products using it. */
export const GET = route(async () => {
  await requireActor('products.view')
  const db = await getDb()
  const [items, productCounts] = await Promise.all([listCategories(db), productCountsBy(db, 'categoryId')])
  return json({ items, productCounts })
})

export const POST = route(async (req) => {
  const actor = await requireActor('products.edit')
  const input = await readBody(req, catalogEntrySchema)
  return json(await createCategory(await getDb(), actor, input), { status: 201 })
})
