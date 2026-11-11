import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, ne, sql, type SQL } from 'drizzle-orm'
import type { DateOnly } from '@/types/db'
import { addDays, startOfDateOnly, todayDateOnly } from '@/lib/datetime'
import { BusinessError } from '@/lib/errors'
import type { Period, ReportColumn, ReportName, ReportResult, ReportRow } from '@/lib/reports'
import type { Db } from '../db'
import {
  categories,
  customers,
  expenses,
  productBatches,
  products,
  purchaseItems,
  purchaseReturns,
  purchases,
  saleItems,
  salePayments,
  saleReturns,
  sales,
  shifts,
  stockMovements,
  suppliers,
} from '../db/schema'
import { cashEvents, profitAndLoss } from './finance'
import { getSettings } from './settings'

/**
 * ReportService: every report is computed from the recorded documents for a date range in the shop
 * timezone. Cancelled sales and purchases are excluded; voided expenses and payments too.
 */

export interface ReportParams {
  from: DateOnly
  to: DateOnly
  period: Period
}

const n = (v: unknown) => Number(v ?? 0)
const col = (key: string, type: ReportColumn['type'] = 'text', enumNs?: string): ReportColumn => ({ key, type, ...(enumNs && { enumNs }) })
const sum = (rows: ReportRow[], keys: string[], label = 'total'): ReportRow => {
  const out: ReportRow = { [Object.keys(rows[0] ?? {})[0] ?? 'label']: label }
  for (const k of keys) out[k] = rows.reduce((s, r) => s + n(r[k]), 0)
  return out
}

export async function runReport(db: Db, name: ReportName, p: ReportParams): Promise<ReportResult> {
  const settings = await getSettings(db)
  const tz = settings.timezone
  const start = startOfDateOnly(p.from)
  const end = startOfDateOnly(addDays(p.to, 1))
  const inRange = (c: Parameters<typeof gte>[0]) => and(gte(c, start), lt(c, end))
  const liveSales = and(ne(sales.status, 'cancelled'), inRange(sales.createdAt))
  const livePurchases = and(ne(purchases.status, 'cancelled'), gte(purchases.purchaseDate, p.from), lte(purchases.purchaseDate, p.to))
  const fmt = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM', year: 'YYYY' }[p.period]
  const tsBucket = (c: SQL | Parameters<typeof gte>[0]): SQL<string> =>
    p.period === 'week' ? sql<string>`to_char(date_trunc('week', ${c} at time zone ${tz}), ${fmt})` : sql<string>`to_char(${c} at time zone ${tz}, ${fmt})`
  const dateBucket = (c: Parameters<typeof gte>[0]): SQL<string> => (p.period === 'week' ? sql<string>`to_char(date_trunc('week', ${c}), ${fmt})` : sql<string>`to_char(${c}, ${fmt})`)

  switch (name) {
    // ---------------------------------------------------------------- sales
    case 'sales-period': {
      const b = tsBucket(sales.createdAt)
      const rows = await db
        .select({
          period: b,
          invoices: sql<number>`count(*)`,
          sales: sql<string>`sum(${sales.total})`,
          discount: sql<string>`sum(${sales.itemDiscountTotal} + ${sales.invoiceDiscount})`,
          vat: sql<string>`sum(${sales.taxTotal})`,
          due: sql<string>`sum(${sales.due})`,
          cogs: sql<string>`sum(${sales.cogs})`,
        })
        .from(sales)
        .where(liveSales)
        // Parameters differ per occurrence, so group and sort by the first column.
        .groupBy(sql`1`)
        .orderBy(sql`1`)
      const out = rows.map((r) => ({ period: r.period, invoices: n(r.invoices), sales: n(r.sales), discount: n(r.discount), vat: n(r.vat), due: n(r.due), cogs: n(r.cogs), profit: n(r.sales) - n(r.vat) - n(r.cogs) }))
      return {
        columns: [col('period'), col('invoices', 'number'), col('sales', 'money'), col('discount', 'money'), col('vat', 'money'), col('due', 'money'), col('cogs', 'money'), col('profit', 'money')],
        rows: out,
        totals: sum(out, ['invoices', 'sales', 'discount', 'vat', 'due', 'cogs', 'profit']),
        chart: { type: 'bar', x: 'period', y: ['sales', 'profit'] },
      }
    }
    case 'sales-product':
    case 'best-selling': {
      const rows = await db
        .select({
          product: max(saleItems.productName),
          sku: max(saleItems.sku),
          unit: max(products.baseUnitName),
          qty: sql<string>`sum(${saleItems.baseQty} - ${saleItems.returnedBaseQty})`,
          sales: sql<string>`sum(${saleItems.lineTotal})`,
          cost: sql<string>`sum(${saleItems.costTotal})`,
          tax: sql<string>`sum(${saleItems.tax})`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .innerJoin(products, eq(products.id, saleItems.productId))
        .where(liveSales)
        .groupBy(saleItems.productId)
        .orderBy(desc(sql`sum(${saleItems.lineTotal})`))
        .limit(name === 'best-selling' ? 20 : 1000)
      const out = rows.map((r) => ({ product: r.product, sku: r.sku, qty: n(r.qty), unit: r.unit, sales: n(r.sales), cost: n(r.cost), profit: n(r.sales) - n(r.tax) - n(r.cost) }))
      return {
        columns: [col('product'), col('sku'), col('qty', 'qty'), col('unit'), col('sales', 'money'), col('cost', 'money'), col('profit', 'money')],
        rows: out,
        totals: sum(out, ['sales', 'cost', 'profit']),
        chart: { type: 'bar', x: 'product', y: ['sales'] },
      }
    }
    case 'sales-category': {
      const rows = await db
        .select({
          category: max(categories.name),
          lines: sql<number>`count(*)`,
          sales: sql<string>`sum(${saleItems.lineTotal})`,
          cost: sql<string>`sum(${saleItems.costTotal})`,
          tax: sql<string>`sum(${saleItems.tax})`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .innerJoin(products, eq(products.id, saleItems.productId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(liveSales)
        .groupBy(products.categoryId)
        .orderBy(desc(sql`sum(${saleItems.lineTotal})`))
      const out = rows.map((r) => ({ category: r.category, lines: n(r.lines), sales: n(r.sales), cost: n(r.cost), profit: n(r.sales) - n(r.tax) - n(r.cost) }))
      return { columns: [col('category'), col('lines', 'number'), col('sales', 'money'), col('cost', 'money'), col('profit', 'money')], rows: out, totals: sum(out, ['lines', 'sales', 'cost', 'profit']), chart: { type: 'pie', x: 'category', y: ['sales'] } }
    }
    case 'sales-customer':
    case 'sales-cashier':
    case 'sales-mode': {
      const key = name === 'sales-customer' ? sales.customerName : name === 'sales-cashier' ? sales.cashierName : sales.priceMode
      const rows = await db
        .select({ who: key, invoices: sql<number>`count(*)`, sales: sql<string>`sum(${sales.total})`, paid: sql<string>`sum(${sales.paid})`, due: sql<string>`sum(${sales.due})` })
        .from(sales)
        .where(liveSales)
        .groupBy(key)
        .orderBy(desc(sql`sum(${sales.total})`))
      const label = name === 'sales-customer' ? 'customer' : name === 'sales-cashier' ? 'cashier' : 'mode'
      const out = rows.map((r) => ({ [label]: r.who || null, invoices: n(r.invoices), sales: n(r.sales), average: Math.round(n(r.sales) / Math.max(1, n(r.invoices))), paid: n(r.paid), due: n(r.due) }))
      return {
        columns: [col(label, 'text', name === 'sales-mode' ? 'saleDetail' : undefined), col('invoices', 'number'), col('sales', 'money'), col('average', 'money'), col('paid', 'money'), col('due', 'money')],
        rows: out,
        totals: sum(out, ['invoices', 'sales', 'paid', 'due']),
        chart: { type: name === 'sales-mode' ? 'pie' : 'bar', x: label, y: ['sales'] },
      }
    }
    case 'sales-method': {
      const rows = await db
        .select({ method: salePayments.method, count: sql<number>`count(*)`, amount: sql<string>`sum(${salePayments.amount})` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(liveSales)
        .groupBy(salePayments.method)
        .orderBy(desc(sql`sum(${salePayments.amount})`))
      const out = rows.map((r) => ({ method: r.method, count: n(r.count), amount: n(r.amount) }))
      return { columns: [col('method', 'text', 'paymentMethods'), col('count', 'number'), col('amount', 'money')], rows: out, totals: sum(out, ['count', 'amount']), chart: { type: 'pie', x: 'method', y: ['amount'] } }
    }

    // ---------------------------------------------------------------- purchases
    case 'purchases-period': {
      const b = dateBucket(purchases.purchaseDate)
      const rows = await db
        .select({ period: b, purchases: sql<number>`count(*)`, total: sql<string>`sum(${purchases.total})`, paid: sql<string>`sum(${purchases.paid})`, due: sql<string>`sum(${purchases.due})` })
        .from(purchases)
        .where(livePurchases)
        // Parameters differ per occurrence, so group and sort by the first column.
        .groupBy(sql`1`)
        .orderBy(sql`1`)
      const out = rows.map((r) => ({ period: r.period, purchases: n(r.purchases), total: n(r.total), paid: n(r.paid), due: n(r.due) }))
      return { columns: [col('period'), col('purchases', 'number'), col('total', 'money'), col('paid', 'money'), col('due', 'money')], rows: out, totals: sum(out, ['purchases', 'total', 'paid', 'due']), chart: { type: 'bar', x: 'period', y: ['total'] } }
    }
    case 'purchases-supplier': {
      const rows = await db
        .select({ supplier: purchases.supplierName, purchases: sql<number>`count(*)`, total: sql<string>`sum(${purchases.total})`, paid: sql<string>`sum(${purchases.paid})`, due: sql<string>`sum(${purchases.due})` })
        .from(purchases)
        .where(livePurchases)
        .groupBy(purchases.supplierName)
        .orderBy(desc(sql`sum(${purchases.total})`))
      const out = rows.map((r) => ({ supplier: r.supplier || null, purchases: n(r.purchases), total: n(r.total), paid: n(r.paid), due: n(r.due) }))
      return { columns: [col('supplier'), col('purchases', 'number'), col('total', 'money'), col('paid', 'money'), col('due', 'money')], rows: out, totals: sum(out, ['purchases', 'total', 'paid', 'due']), chart: { type: 'bar', x: 'supplier', y: ['total'] } }
    }
    case 'purchases-product': {
      const rows = await db
        .select({ product: max(purchaseItems.productName), unit: max(products.baseUnitName), qty: sql<string>`sum(${purchaseItems.baseQty} - ${purchaseItems.returnedBaseQty})`, total: sql<string>`sum(${purchaseItems.lineTotal})` })
        .from(purchaseItems)
        .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
        .innerJoin(products, eq(products.id, purchaseItems.productId))
        .where(livePurchases)
        .groupBy(purchaseItems.productId)
        .orderBy(desc(sql`sum(${purchaseItems.lineTotal})`))
      const out = rows.map((r) => ({ product: r.product, qty: n(r.qty), unit: r.unit, total: n(r.total), avgCost: n(r.qty) ? Math.round(n(r.total) / n(r.qty)) : 0 }))
      return { columns: [col('product'), col('qty', 'qty'), col('unit'), col('total', 'money'), col('avgCost', 'money')], rows: out, totals: sum(out, ['total']), chart: { type: 'bar', x: 'product', y: ['total'] } }
    }
    case 'purchase-due': {
      const rows = await db
        .select()
        .from(purchases)
        .where(and(ne(purchases.status, 'cancelled'), gt(purchases.due, 0)))
        .orderBy(desc(purchases.purchaseDate))
        .limit(1000)
      const out = rows.map((r) => ({ purchase: r.purchaseNo, date: r.purchaseDate, supplier: r.supplierName || null, total: r.total, paid: r.paid, due: r.due }))
      return { columns: [col('purchase'), col('date', 'date'), col('supplier'), col('total', 'money'), col('paid', 'money'), col('due', 'money')], rows: out, totals: sum(out, ['total', 'paid', 'due']) }
    }

    // ---------------------------------------------------------------- inventory
    case 'stock-current':
    case 'stock-low': {
      const rows = await db
        .select({ p: products, category: categories.name })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(and(eq(products.status, 'active'), name === 'stock-low' ? and(gt(products.minStockQty, 0), lte(products.stockQty, products.minStockQty)) : undefined))
        .orderBy(asc(products.name))
      const out = rows.map((r) => ({ product: r.p.name, sku: r.p.sku, category: r.category, qty: r.p.stockQty, ...(name === 'stock-low' && { minQty: r.p.minStockQty }), unit: r.p.baseUnitName, value: r.p.stockQty > 0 ? r.p.stockValue : 0 }))
      return {
        columns: [col('product'), col('sku'), col('category'), col('qty', 'qty'), ...(name === 'stock-low' ? [col('minQty', 'qty')] : []), col('unit'), col('value', 'money')],
        rows: out,
        totals: sum(out, ['value']),
      }
    }
    case 'stock-valuation': {
      const rows = await db
        .select({
          category: max(categories.name),
          products: sql<number>`count(*) filter (where ${products.stockQty} > 0)`,
          value: sql<string>`coalesce(sum(${products.stockValue}) filter (where ${products.stockQty} > 0), 0)`,
        })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(eq(products.status, 'active'))
        .groupBy(products.categoryId)
        .orderBy(desc(sql`coalesce(sum(${products.stockValue}) filter (where ${products.stockQty} > 0), 0)`))
      const out = rows.map((r) => ({ category: r.category, products: n(r.products), value: n(r.value) }))
      return { columns: [col('category'), col('products', 'number'), col('value', 'money')], rows: out, totals: sum(out, ['products', 'value']), chart: { type: 'pie', x: 'category', y: ['value'] } }
    }
    case 'stock-movements': {
      const rows = await db
        .select({ type: stockMovements.type, count: sql<number>`count(*)`, value: sql<string>`sum(${stockMovements.valueChange})` })
        .from(stockMovements)
        .where(inRange(stockMovements.createdAt))
        .groupBy(stockMovements.type)
        .orderBy(asc(stockMovements.type))
      const out = rows.map((r) => ({ type: r.type, count: n(r.count), value: n(r.value) }))
      return { columns: [col('type', 'text', 'movement'), col('count', 'number'), col('value', 'money')], rows: out, totals: sum(out, ['count', 'value']) }
    }
    case 'stock-batches':
    case 'stock-expiring':
    case 'stock-expired': {
      const today = todayDateOnly()
      const cond =
        name === 'stock-expired'
          ? lt(productBatches.expiryDate, today)
          : name === 'stock-expiring'
            ? and(gte(productBatches.expiryDate, today), lte(productBatches.expiryDate, addDays(today, settings.expiryWarningDays)))
            : undefined
      const rows = await db
        .select({ b: productBatches, product: products.name, unit: products.baseUnitName })
        .from(productBatches)
        .innerJoin(products, eq(products.id, productBatches.productId))
        .where(and(gt(productBatches.qtyRemaining, 0), cond))
        .orderBy(asc(productBatches.expiryDate))
      const out = rows.map((r) => ({
        batch: r.b.batchNo,
        product: r.product,
        expiry: r.b.expiryDate === '9999-12-31' ? null : r.b.expiryDate,
        qty: r.b.qtyRemaining,
        unit: r.unit,
        value: r.b.qtyReceived ? Math.round((r.b.costTotal * r.b.qtyRemaining) / r.b.qtyReceived) : 0,
      }))
      return { columns: [col('batch'), col('product'), col('expiry', 'date'), col('qty', 'qty'), col('unit'), col('value', 'money')], rows: out, totals: sum(out, ['value']) }
    }
    case 'stock-damaged': {
      const rows = await db
        .select({ m: stockMovements, product: products.name, unit: products.baseUnitName })
        .from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId))
        .where(and(inArray(stockMovements.type, ['damaged', 'lost', 'expired']), inRange(stockMovements.createdAt)))
        .orderBy(desc(stockMovements.createdAt))
      const out = rows.map((r) => ({ date: r.m.createdAt, product: r.product, type: r.m.type, qty: -r.m.qtyChange, unit: r.unit, value: -r.m.valueChange, reason: r.m.reason }))
      return { columns: [col('date', 'datetime'), col('product'), col('type', 'text', 'movement'), col('qty', 'qty'), col('unit'), col('value', 'money'), col('reason')], rows: out, totals: sum(out, ['value']) }
    }

    // ---------------------------------------------------------------- finance
    case 'profit-loss': {
      const pl = await profitAndLoss(db, p.from, p.to)
      const rows: ReportRow[] = [
        { line: 'sales', amount: pl.sales },
        { line: 'returns', amount: -pl.returns },
        { line: 'netSales', amount: pl.netSales },
        { line: 'cogs', amount: -pl.costOfGoods },
        { line: 'grossProfit', amount: pl.grossProfit },
        { line: 'stockLoss', amount: -pl.stockLoss },
        { line: 'expenses', amount: -pl.expenses },
        { line: 'netProfit', amount: pl.netProfit },
      ]
      return { columns: [col('line', 'text', 'reports.pl'), col('amount', 'money')], rows }
    }
    case 'expenses': {
      const rows = await db
        .select({ category: expenses.category, count: sql<number>`count(*)`, amount: sql<string>`sum(${expenses.amount})` })
        .from(expenses)
        .where(and(eq(expenses.status, 'active'), gte(expenses.expenseDate, p.from), lte(expenses.expenseDate, p.to)))
        .groupBy(expenses.category)
        .orderBy(desc(sql`sum(${expenses.amount})`))
      const out = rows.map((r) => ({ category: r.category, count: n(r.count), amount: n(r.amount) }))
      return { columns: [col('category', 'text', 'expenses.categories'), col('count', 'number'), col('amount', 'money')], rows: out, totals: sum(out, ['count', 'amount']), chart: { type: 'pie', x: 'category', y: ['amount'] } }
    }
    case 'customer-due':
    case 'supplier-due': {
      const table = name === 'customer-due' ? customers : suppliers
      const rows = await db.select().from(table).where(gt(table.balance, 0)).orderBy(desc(table.balance))
      const out = rows.map((r) => ({ name: r.name, phone: r.phone, balance: r.balance }))
      return { columns: [col('name'), col('phone'), col('balance', 'money')], rows: out, totals: sum(out, ['balance']) }
    }
    case 'cash-flow':
    case 'payment-methods': {
      const events = await cashEvents(db, { from: start, to: end })
      const map = new Map<string, { in: number; out: number }>()
      for (const e of events) {
        const k = name === 'cash-flow' ? bucketOf(e.at, p.period, tz) : e.method
        const cur = map.get(k) ?? { in: 0, out: 0 }
        cur[e.direction] += e.amount
        map.set(k, cur)
      }
      const key = name === 'cash-flow' ? 'period' : 'method'
      const out = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ [key]: k, in: v.in, out: v.out, net: v.in - v.out }))
      return {
        columns: [col(key, 'text', name === 'payment-methods' ? 'paymentMethods' : undefined), col('in', 'money'), col('out', 'money'), col('net', 'money')],
        rows: out,
        totals: sum(out, ['in', 'out', 'net']),
        chart: { type: name === 'cash-flow' ? 'line' : 'bar', x: key, y: ['in', 'out'] },
      }
    }

    // ---------------------------------------------------------------- other
    case 'slow-moving': {
      const sold = db
        .select({ id: saleItems.productId })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(liveSales)
      const last = await db
        .select({ id: saleItems.productId, at: max(sales.createdAt) })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(ne(sales.status, 'cancelled'))
        .groupBy(saleItems.productId)
      const lastById = new Map(last.map((l) => [l.id, l.at]))
      const rows = await db
        .select()
        .from(products)
        .where(and(eq(products.status, 'active'), gt(products.stockQty, 0), sql`${products.id} not in (${sold})`))
        .orderBy(desc(products.stockValue))
      const out = rows.map((r) => ({ product: r.name, qty: r.stockQty, unit: r.baseUnitName, value: r.stockValue, lastSold: lastById.get(r.id) ?? null }))
      return { columns: [col('product'), col('qty', 'qty'), col('unit'), col('value', 'money'), col('lastSold', 'datetime')], rows: out, totals: sum(out, ['value']) }
    }
    case 'sales-returns': {
      const rows = await db.select().from(saleReturns).where(inRange(saleReturns.createdAt)).orderBy(desc(saleReturns.createdAt))
      const out = rows.map((r) => ({ return: r.returnNo, date: r.createdAt, invoice: r.invoiceNo, customer: r.customerName || null, total: r.total, dueAdjusted: r.dueAdjusted, refund: r.refund, reason: r.reason }))
      return {
        columns: [col('return'), col('date', 'datetime'), col('invoice'), col('customer'), col('total', 'money'), col('dueAdjusted', 'money'), col('refund', 'money'), col('reason')],
        rows: out,
        totals: sum(out, ['total', 'dueAdjusted', 'refund']),
      }
    }
    case 'purchase-returns': {
      const rows = await db.select().from(purchaseReturns).where(inRange(purchaseReturns.createdAt)).orderBy(desc(purchaseReturns.createdAt))
      const out = rows.map((r) => ({ return: r.returnNo, date: r.createdAt, purchase: r.purchaseNo, supplier: r.supplierName || null, total: r.total, payableAdjusted: r.payableAdjusted, refund: r.refundReceived, reason: r.reason }))
      return {
        columns: [col('return'), col('date', 'datetime'), col('purchase'), col('supplier'), col('total', 'money'), col('payableAdjusted', 'money'), col('refund', 'money'), col('reason')],
        rows: out,
        totals: sum(out, ['total', 'payableAdjusted', 'refund']),
      }
    }
    case 'shifts': {
      const rows = await db.select().from(shifts).where(inRange(shifts.openedAt)).orderBy(desc(shifts.openedAt))
      const out = rows.map((r) => ({ cashier: r.userName, opened: r.openedAt, closed: r.closedAt, opening: r.openingCash, expected: r.expectedCash, counted: r.countedCash, difference: r.difference }))
      return {
        columns: [col('cashier'), col('opened', 'datetime'), col('closed', 'datetime'), col('opening', 'money'), col('expected', 'money'), col('counted', 'money'), col('difference', 'money')],
        rows: out,
        totals: sum(out, ['difference']),
      }
    }
  }
  throw new BusinessError('not_found', 'Unknown report.', { key: 'unknownReport' })
}

/** Bucket key of a timestamp in the shop timezone (cash flow is built in JS from events). */
function bucketOf(ts: number, period: Period, tz: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]))
  const day = `${parts.year}-${parts.month}-${parts.day}`
  if (period === 'day') return day
  if (period === 'month') return day.slice(0, 7)
  if (period === 'year') return day.slice(0, 4)
  // ISO week starting Monday.
  const d = new Date(`${day}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  return addDays(day, -back)
}

/** Keys that reveal cost or profit; removed for roles without products.view_cost. */
export const COST_KEYS = ['cogs', 'cost', 'profit', 'value', 'avgCost']

export function hideCostColumns(r: ReportResult): ReportResult {
  const keep = r.columns.filter((c) => !COST_KEYS.includes(c.key))
  const strip = (row: ReportRow) => Object.fromEntries(Object.entries(row).filter(([k]) => !COST_KEYS.includes(k)))
  return {
    ...r,
    columns: keep,
    rows: r.rows.map(strip),
    totals: r.totals && strip(r.totals),
    chart: r.chart && { ...r.chart, y: r.chart.y.filter((k) => !COST_KEYS.includes(k)) },
  }
}
