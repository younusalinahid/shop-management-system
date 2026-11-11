import { and, asc, desc, gte, lt } from 'drizzle-orm'
import type { DateOnly } from '@/types/db'
import { toCsv } from '@/lib/csv'
import { addDays, formatDateTime, startOfDateOnly } from '@/lib/datetime'
import { integerToDecimalString } from '@/lib/decimal'
import type { Db } from '../db'
import { customers, purchases, sales, suppliers } from '../db/schema'

/** CSV exports for spreadsheets. Amounts are plain decimals (taka); text that looks like a formula is quoted. */

export type ExportKind = 'sales' | 'purchases' | 'customers' | 'suppliers'
export const EXPORT_KINDS: readonly ExportKind[] = ['sales', 'purchases', 'customers', 'suppliers']

const tk = (poisha: number | null | undefined) => (poisha === null || poisha === undefined ? '' : integerToDecimalString(poisha, 2))
// Spreadsheet formula injection guard.
const txt = (s: string | null | undefined) => (s && /^[=+\-@]/.test(s) ? `'${s}` : (s ?? ''))

export async function exportCsv(db: Db, kind: ExportKind, range: { from?: DateOnly; to?: DateOnly }): Promise<string> {
  const start = range.from ? startOfDateOnly(range.from) : undefined
  const end = range.to ? startOfDateOnly(addDays(range.to, 1)) : undefined
  switch (kind) {
    case 'sales': {
      const rows = await db
        .select()
        .from(sales)
        .where(and(start !== undefined ? gte(sales.createdAt, start) : undefined, end !== undefined ? lt(sales.createdAt, end) : undefined))
        .orderBy(desc(sales.createdAt))
      return toCsv([
        ['invoice_no', 'date', 'customer', 'phone', 'cashier', 'price_mode', 'status', 'subtotal', 'discount', 'vat', 'total', 'paid', 'due', 'change'],
        ...rows.map((s) => [
          s.invoiceNo,
          formatDateTime(s.createdAt),
          txt(s.customerName),
          txt(s.customerPhone),
          txt(s.cashierName),
          s.priceMode,
          s.status,
          tk(s.subtotal),
          tk(s.itemDiscountTotal + s.invoiceDiscount),
          tk(s.taxTotal),
          tk(s.total),
          tk(s.paid),
          tk(s.due),
          tk(s.changeGiven),
        ]),
      ])
    }
    case 'purchases': {
      const rows = await db
        .select()
        .from(purchases)
        .where(and(range.from ? gte(purchases.purchaseDate, range.from) : undefined, range.to ? lt(purchases.purchaseDate, addDays(range.to, 1)) : undefined))
        .orderBy(desc(purchases.purchaseDate))
      return toCsv([
        ['purchase_no', 'date', 'supplier', 'reference', 'status', 'subtotal', 'discount', 'extra_cost', 'total', 'paid', 'due'],
        ...rows.map((p) => [p.purchaseNo, p.purchaseDate, txt(p.supplierName), txt(p.referenceNo), p.status, tk(p.subtotal), tk(p.discount), tk(p.additionalCost), tk(p.total), tk(p.paid), tk(p.due)]),
      ])
    }
    case 'customers': {
      const rows = await db.select().from(customers).orderBy(asc(customers.name))
      return toCsv([
        ['name', 'phone', 'address', 'price_mode', 'opening_balance', 'due', 'status'],
        ...rows.map((c) => [txt(c.name), txt(c.phone), txt(c.address), c.priceMode ?? '', tk(c.openingBalance), tk(c.balance), c.status]),
      ])
    }
    case 'suppliers': {
      const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name))
      return toCsv([
        ['name', 'company', 'phone', 'address', 'opening_balance', 'payable', 'status'],
        ...rows.map((s) => [txt(s.name), txt(s.companyName), txt(s.phone), txt(s.address), tk(s.openingBalance), tk(s.balance), s.status]),
      ])
    }
  }
}
