import { and, count, eq, gt, lte, sql } from 'drizzle-orm'
import { can } from '@/lib/permissions'
import { expiryCounts } from '@/server/services/inventory'
import { getSettings } from '@/server/services/settings'
import { getDb } from '@/server/db'
import { brands, categories, products } from '@/server/db/schema'
import { json, requireActor, route } from '@/server/http'

/** Dashboard figures. Only modules built so far report numbers (catalog, inventory); sales and finance arrive in later phases. */
export const GET = route(async () => {
  const actor = await requireActor('sales.view')
  const db = await getDb()
  const settings = await getSettings(db)
  const [[active], [low], [cats], [brandCount], [value], expiry] = await Promise.all([
    db.select({ n: count() }).from(products).where(eq(products.status, 'active')),
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.status, 'active'), gt(products.minStockQty, 0), lte(products.stockQty, products.minStockQty))),
    db.select({ n: count() }).from(categories).where(eq(categories.status, 'active')),
    db.select({ n: count() }).from(brands).where(eq(brands.status, 'active')),
    db.select({ v: sql<string>`coalesce(sum(case when ${products.stockQty} > 0 then ${products.stockValue} else 0 end), 0)` }).from(products),
    expiryCounts(db, settings.expiryWarningDays),
  ])
  return json({
    activeProducts: active.n,
    lowStockProducts: low.n,
    categories: cats.n,
    brands: brandCount.n,
    // Stock value reveals cost; null for roles that cannot see purchase prices.
    stockValue: can(actor.role, 'products.view_cost') ? Number(value.v) : null,
    expiringBatches: expiry.expiring,
    expiredBatches: expiry.expired,
  })
})
