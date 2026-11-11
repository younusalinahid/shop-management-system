/**
 * Report definitions shared by the reports page and the API. Every report returns the same shape, so one
 * table, one chart and one CSV export serve all of them. Column labels are translated (reports.col.<key>).
 */

export type ColumnType = 'text' | 'money' | 'number' | 'qty' | 'date' | 'datetime' | 'percent'

export interface ReportColumn {
  key: string
  type: ColumnType
  /** Translate values through this message namespace (e.g. payment methods); unknown values show as they are. */
  enumNs?: string
}

export type ReportRow = Record<string, string | number | null>

export interface ReportResult {
  columns: ReportColumn[]
  rows: ReportRow[]
  /** Sum of money/number columns where a total makes sense. */
  totals?: ReportRow
  /** Suggested chart: x is a text/date column, y are money/number columns. */
  chart?: { type: 'bar' | 'line' | 'pie'; x: string; y: string[] }
}

export const REPORT_GROUPS = {
  sales: ['sales-period', 'sales-product', 'sales-category', 'sales-customer', 'sales-cashier', 'sales-mode', 'sales-method'],
  purchases: ['purchases-period', 'purchases-supplier', 'purchases-product', 'purchase-due'],
  inventory: ['stock-current', 'stock-low', 'stock-valuation', 'stock-movements', 'stock-batches', 'stock-expiring', 'stock-expired', 'stock-damaged'],
  finance: ['profit-loss', 'expenses', 'customer-due', 'supplier-due', 'cash-flow', 'payment-methods'],
  other: ['best-selling', 'slow-moving', 'sales-returns', 'purchase-returns', 'shifts'],
} as const

export type ReportName = (typeof REPORT_GROUPS)[keyof typeof REPORT_GROUPS][number]
export const REPORT_NAMES = Object.values(REPORT_GROUPS).flat() as ReportName[]

/** Reports whose numbers reveal purchase cost or profit. */
export const COST_REPORTS: readonly ReportName[] = [
  'purchases-period',
  'purchases-supplier',
  'purchases-product',
  'purchase-due',
  'stock-valuation',
  'profit-loss',
  'supplier-due',
  'purchase-returns',
]

/** Reports that use a date range (the others are a snapshot of now). */
export const DATED_REPORTS: readonly ReportName[] = REPORT_NAMES.filter(
  (n) => !['purchase-due', 'stock-current', 'stock-low', 'stock-valuation', 'stock-batches', 'stock-expiring', 'stock-expired', 'customer-due', 'supplier-due'].includes(n),
)

export type Period = 'day' | 'week' | 'month' | 'year'
