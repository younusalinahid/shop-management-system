import { and, count, desc, eq, gt, lte, ne, sql } from 'drizzle-orm'
import { endOfDay, startOfDay, todayDateOnly } from '@/lib/datetime'
import { can } from '@/lib/permissions'
import { getDb } from '@/server/db'
import { brands, categories, customers, products, purchases, sales, stockMovements, suppliers } from '@/server/db/schema'
import { json, requireActor, route } from '@/server/http'
import { cashEvents, profitAndLoss } from '@/server/services/finance'
import { expiryCounts } from '@/server/services/inventory'
import { salesBetween } from '@/server/services/sale'
import { getSettings } from '@/server/services/settings'

/**
 * Dashboard figures, all computed from recorded documents. Figures that reveal cost or profit are null for
 * roles that may not see them.
 */
export const GET = route(async () => {
  const actor = await requireActor('sales.view')
  const db = await getDb()
  const settings = await getSettings(db)
  const now = Date.now()
  const today = todayDateOnly()
  const seeCost = can(actor.role, 'products.view_cost')
  const seeProfit = can(actor.role, 'reports.profit')
  const seePurchases = can(actor.role, 'purchases.manage')

  const [[active], [low], [cats], [brandCount], [value], expiry, [cust], [sup], todaySales, events, pl, recentSales, recentPurchases, recentMoves] = await Promise.all([
    db.select({ n: count() }).from(products).where(eq(products.status, 'active')),
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.status, 'active'), gt(products.minStockQty, 0), lte(products.stockQty, products.minStockQty))),
    db.select({ n: count() }).from(categories).where(eq(categories.status, 'active')),
    db.select({ n: count() }).from(brands).where(eq(brands.status, 'active')),
    db.select({ v: sql<string>`coalesce(sum(case when ${products.stockQty} > 0 then ${products.stockValue} else 0 end), 0)` }).from(products),
    expiryCounts(db, settings.expiryWarningDays),
    db.select({ n: count(), due: sql<string>`coalesce(sum(${customers.balance}) filter (where ${customers.balance} > 0), 0)` }).from(customers).where(eq(customers.status, 'active')),
    db.select({ n: count(), due: sql<string>`coalesce(sum(${suppliers.balance}) filter (where ${suppliers.balance} > 0), 0)` }).from(suppliers).where(eq(suppliers.status, 'active')),
    salesBetween(db, startOfDay(now), endOfDay(now)),
    cashEvents(db, { from: startOfDay(now), to: endOfDay(now) }),
    profitAndLoss(db, today, today),
    db.select().from(sales).where(ne(sales.status, 'cancelled')).orderBy(desc(sales.createdAt)).limit(6),
    seePurchases ? db.select().from(purchases).where(ne(purchases.status, 'cancelled')).orderBy(desc(purchases.createdAt)).limit(6) : Promise.resolve([]),
    db
      .select({ id: stockMovements.id, type: stockMovements.type, qtyChange: stockMovements.qtyChange, createdAt: stockMovements.createdAt, productId: stockMovements.productId, productName: products.name, baseUnitName: products.baseUnitName })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .orderBy(desc(stockMovements.createdAt))
      .limit(6),
  ])

  return json({
    activeProducts: active.n,
    lowStockProducts: low.n,
    categories: cats.n,
    brands: brandCount.n,
    customers: cust.n,
    suppliers: sup.n,
    customerDue: Number(cust.due),
    supplierDue: seePurchases ? Number(sup.due) : null,
    stockValue: seeCost ? Number(value.v) : null,
    expiringBatches: expiry.expiring,
    expiredBatches: expiry.expired,
    todaySales: todaySales.total,
    todayInvoices: todaySales.count,
    todayDue: todaySales.due,
    /** All money that came in today (sales, collections, refunds received). */
    todayCollection: events.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0),
    todayExpenses: pl.expenses,
    todayProfit: seeProfit ? pl.grossProfit : null,
    todayNetProfit: seeProfit ? pl.netProfit : null,
    recentSales: recentSales.map((s) => ({ id: s.id, invoiceNo: s.invoiceNo, customerName: s.customerName, total: s.total, due: s.due, createdAt: s.createdAt })),
    recentPurchases: recentPurchases.map((p) => ({ id: p.id, purchaseNo: p.purchaseNo, supplierName: p.supplierName, total: p.total, createdAt: p.createdAt })),
    recentMovements: recentMoves,
  })
})
