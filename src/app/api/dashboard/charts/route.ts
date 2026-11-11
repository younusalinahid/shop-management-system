import { addDays, todayDateOnly } from '@/lib/datetime'
import { can } from '@/lib/permissions'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { hideCostColumns, runReport } from '@/server/services/reports'

/** Dashboard charts: daily sales (30 days), monthly sales, purchases and profit (12 months), payment methods and best sellers (this month). */
export const GET = route(async () => {
  const actor = await requireActor('sales.view')
  const db = await getDb()
  const today = todayDateOnly()
  const monthStart = `${today.slice(0, 8)}01`
  const yearAgo = `${addDays(`${today.slice(0, 8)}01`, -335).slice(0, 8)}01`
  const seeCost = can(actor.role, 'products.view_cost')
  const seePurchases = can(actor.role, 'purchases.manage')
  const [daily, monthly, monthlyPurchases, methods, best] = await Promise.all([
    runReport(db, 'sales-period', { from: addDays(today, -29), to: today, period: 'day' }),
    runReport(db, 'sales-period', { from: yearAgo, to: today, period: 'month' }),
    seePurchases ? runReport(db, 'purchases-period', { from: yearAgo, to: today, period: 'month' }) : Promise.resolve(null),
    runReport(db, 'sales-method', { from: monthStart, to: today, period: 'month' }),
    runReport(db, 'best-selling', { from: monthStart, to: today, period: 'month' }),
  ])
  const clean = (r: Awaited<ReturnType<typeof runReport>>) => (seeCost ? r : hideCostColumns(r))
  const purchaseByMonth = new Map((monthlyPurchases?.rows ?? []).map((r) => [String(r.period), Number(r.total)]))
  const salesByMonth = new Map(clean(monthly).rows.map((r) => [String(r.period), r]))
  // Months with purchases but no sales still belong on the chart.
  const months = [...new Set([...salesByMonth.keys(), ...purchaseByMonth.keys()])].sort()
  return json({
    daily: clean(daily).rows.map((r) => ({ day: r.period, sales: r.sales, profit: r.profit ?? null })),
    monthly: months.map((m) => ({
      month: m,
      sales: Number(salesByMonth.get(m)?.sales ?? 0),
      profit: seeCost ? Number(salesByMonth.get(m)?.profit ?? 0) : null,
      purchases: seePurchases ? (purchaseByMonth.get(m) ?? 0) : null,
    })),
    methods: methods.rows.map((r) => ({ method: r.method, amount: r.amount })),
    bestSellers: clean(best).rows.slice(0, 5).map((r) => ({ product: r.product, qty: r.qty, unit: r.unit, sales: r.sales })),
  })
})
