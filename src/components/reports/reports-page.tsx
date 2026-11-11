'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, FileBarChart, Printer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { toCsv, downloadText } from '@/lib/csv'
import { addDays, formatDate, formatDateOnly, formatDateTime, todayDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { integerToDecimalString } from '@/lib/decimal'
import { formatMoney } from '@/lib/money'
import { COST_REPORTS, DATED_REPORTS, type Period, REPORT_GROUPS, type ReportColumn, type ReportName, type ReportResult } from '@/lib/reports'
import { formatQtyNumber } from '@/lib/units'
import { cn } from '@/lib/utils'

const PERIOD_REPORTS: readonly ReportName[] = ['sales-period', 'purchases-period', 'cash-flow']
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--primary)']

/** Every report on one page: pick a report, a date range, see the chart and table, export CSV or print. */
export function ReportsPage() {
  const t = useTranslations('reports')
  const settings = useSettings()
  const canProfit = usePermission('reports.profit')
  const [name, setName] = useState<ReportName>('sales-period')
  const [from, setFrom] = useState(`${todayDateOnly().slice(0, 8)}01`)
  const [to, setTo] = useState(todayDateOnly())
  const [period, setPeriod] = useState<Period>('day')
  const dated = DATED_REPORTS.includes(name)

  const params = new URLSearchParams({ from, to, period })
  const q = useQuery({ queryKey: ['report', name, params.toString()], queryFn: () => api.get<ReportResult>(`/api/reports/${name}?${params}`), placeholderData: keepPreviousData })
  const fmt = useCellFormatter()

  const exportCsv = () => {
    if (!q.data) return
    const head = q.data.columns.map((c) => t(`col.${c.key}`))
    // Plain numbers for spreadsheets; text that looks like a formula is quoted so Excel won't run it.
    const cell = (c: ReportColumn, v: unknown) => {
      if (v === null || v === undefined) return ''
      if (c.type === 'money') return integerToDecimalString(Number(v), 2)
      if (c.type === 'date' || c.type === 'datetime' || c.enumNs) return fmt(c, v)
      const s = String(v)
      return /^[=+\-@]/.test(s) ? `'${s}` : s
    }
    const rows = q.data.rows.map((r) => q.data!.columns.map((c) => cell(c, r[c.key])))
    downloadText(`${name}-${from}-${to}.csv`, toCsv([head, ...rows]))
  }

  const presets: Array<[string, () => void]> = [
    [t('today'), () => (setFrom(todayDateOnly()), setTo(todayDateOnly()))],
    [t('last7'), () => (setFrom(addDays(todayDateOnly(), -6)), setTo(todayDateOnly()))],
    [t('thisMonth'), () => (setFrom(`${todayDateOnly().slice(0, 8)}01`), setTo(todayDateOnly()))],
    [t('thisYear'), () => (setFrom(`${todayDateOnly().slice(0, 4)}-01-01`), setTo(todayDateOnly()))],
  ]

  return (
    <>
      <PageHeader
        icon={FileBarChart}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} disabled={!q.data}>
              <Printer /> {t('print')}
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!q.data || q.data.rows.length === 0}>
              <Download /> {t('exportCsv')}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="grid content-start gap-4 print:hidden" aria-label={t('title')}>
          {(Object.keys(REPORT_GROUPS) as Array<keyof typeof REPORT_GROUPS>).map((g) => {
            const items = REPORT_GROUPS[g].filter((n) => canProfit || !COST_REPORTS.includes(n))
            if (!items.length) return null
            return (
              <div key={g}>
                <p className="mb-1 px-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">{t(`group.${g}`)}</p>
                <ul className="grid gap-0.5">
                  {items.map((n) => (
                    <li key={n}>
                      <button
                        type="button"
                        onClick={() => setName(n)}
                        className={cn('w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-primary/10', n === name && 'bg-primary/10 font-semibold text-primary')}
                        aria-current={n === name ? 'page' : undefined}
                      >
                        {t(`name.${n}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>

        <div className="grid min-w-0 content-start gap-4">
          <div className="hidden print:block">
            <p className="text-lg font-bold">{settings.shopName}</p>
            <p className="text-sm">
              {t(`name.${name}`)}
              {dated && ` · ${formatDateOnly(from)} – ${formatDateOnly(to)}`} · {formatDate(Date.now())}
            </p>
          </div>
          <Card className="print:hidden">
            <CardContent className="flex flex-wrap items-center gap-2 py-3">
              <p className="mr-auto text-lg font-bold">{t(`name.${name}`)}</p>
              {dated ? (
                <>
                  {presets.map(([label, set]) => (
                    <Button key={label} variant="ghost" size="sm" onClick={set}>
                      {label}
                    </Button>
                  ))}
                  <Input type="date" className="w-38" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('from')} />
                  <span className="text-sm text-muted-foreground">–</span>
                  <Input type="date" className="w-38" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('to')} />
                  {PERIOD_REPORTS.includes(name) && (
                    <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                      <SelectTrigger className="w-32" aria-label={t('groupBy')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['day', 'week', 'month', 'year'] as const).map((p) => (
                          <SelectItem key={p} value={p}>
                            {t(`period.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">{t('asOfNow')}</span>
              )}
            </CardContent>
          </Card>

          {q.isPending ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
          ) : q.data.rows.length === 0 ? (
            <EmptyState icon={FileBarChart} title={t('emptyTitle')} description={t('emptyText')} />
          ) : (
            <>
              {q.data.chart && q.data.chart.y.length > 0 && q.data.rows.length > 1 && <ReportChart result={q.data} />}
              <Card className="gap-0 overflow-x-auto py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {q.data.columns.map((c) => (
                        <TableHead key={c.key} className={cn(isNumeric(c) && 'text-right')}>
                          {t(`col.${c.key}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data.rows.map((r, i) => (
                      <TableRow key={i}>
                        {q.data.columns.map((c, j) => (
                          <TableCell key={c.key} className={cn('whitespace-nowrap', isNumeric(c) && 'text-right', j === 0 && 'font-medium', c.type === 'money' && Number(r[c.key]) < 0 && 'text-destructive')}>
                            {fmt(c, r[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                  {q.data.totals && (
                    <TableFooter>
                      <TableRow>
                        {q.data.columns.map((c, j) => (
                          <TableCell key={c.key} className={cn('font-bold whitespace-nowrap', isNumeric(c) && 'text-right')}>
                            {j === 0 ? t('total') : c.key in q.data!.totals! ? fmt(c, q.data!.totals![c.key]) : ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}

const isNumeric = (c: ReportColumn) => c.type === 'money' || c.type === 'number' || c.type === 'qty' || c.type === 'percent'

function useCellFormatter() {
  const t = useTranslations()
  return (c: ReportColumn, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    switch (c.type) {
      case 'money':
        return formatMoney(Number(v))
      case 'qty':
      case 'number':
        return formatQtyNumber(Number(v))
      case 'percent':
        return `${Number(v)}%`
      case 'date':
        return formatDateOnly(String(v))
      case 'datetime':
        return formatDateTime(Number(v))
      default: {
        const key = c.enumNs ? `${c.enumNs}.${String(v)}` : ''
        return key && t.has(key) ? t(key) : String(v)
      }
    }
  }
}

function ReportChart({ result }: { result: ReportResult }) {
  const t = useTranslations('reports')
  const fmt = useCellFormatter()
  const chart = result.chart!
  const xCol = result.columns.find((c) => c.key === chart.x)!
  const data = result.rows.slice(0, 40).map((r) => ({ ...r, __x: fmt(xCol, r[chart.x]) }))
  const money = (v: unknown) => formatMoney(Number(v), { fraction: 0 })
  const tick = (v: number) => (Math.abs(v) >= 100_000 ? `${Math.round(v / 10_000) / 10}k` : String(Math.round(v / 100)))
  const axis = { fontSize: 11, fill: 'var(--muted-foreground)' }
  const tip = { contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } }
  return (
    <Card className="print:break-inside-avoid">
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={260}>
          {chart.type === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey={chart.y[0]} nameKey="__x" outerRadius={100} innerRadius={50} paddingAngle={2} label={(e: { name?: string }) => e.name}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={money} {...tip} />
            </PieChart>
          ) : chart.type === 'line' ? (
            <LineChart data={data} margin={{ left: -10, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="__x" tick={axis} tickLine={false} />
              <YAxis tickFormatter={tick} tick={axis} axisLine={false} tickLine={false} />
              <Tooltip formatter={money} {...tip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.y.map((y, i) => (
                <Line key={y} dataKey={y} name={t(`col.${y}`)} stroke={COLORS[i]} strokeWidth={2.5} type="monotone" dot={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ left: -10, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="__x" tick={axis} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={tick} tick={axis} axisLine={false} tickLine={false} />
              <Tooltip formatter={money} {...tip} cursor={{ fill: 'var(--muted)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.y.map((y, i) => (
                <Bar key={y} dataKey={y} name={t(`col.${y}`)} fill={COLORS[i]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
