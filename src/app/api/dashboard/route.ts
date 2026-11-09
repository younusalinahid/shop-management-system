import { and, count, eq, gt, lte } from 'drizzle-orm'
import { getDb } from '@/server/db'
import { brands, categories, products } from '@/server/db/schema'
import { json, requireActor, route } from '@/server/http'

/** Dashboard figures. Only modules built so far report numbers; sales and finance arrive in later phases. */
export const GET = route(async () => {
  await requireActor('sales.view')
  const db = await getDb()
  const [[active], [low], [cats], [brandCount]] = await Promise.all([
    db.select({ n: count() }).from(products).where(eq(products.status, 'active')),
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.status, 'active'), gt(products.minStockQty, 0), lte(products.stockQty, products.minStockQty))),
    db.select({ n: count() }).from(categories).where(eq(categories.status, 'active')),
    db.select({ n: count() }).from(brands).where(eq(brands.status, 'active')),
  ])
  return json({ activeProducts: active.n, lowStockProducts: low.n, categories: cats.n, brands: brandCount.n })
})
