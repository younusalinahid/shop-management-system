'use client'

import { useTranslations } from 'next-intl'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { addDays, todayDateOnly } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatQtyNumber } from '@/lib/units'
import type { PaymentMethod } from '@/types/db'

export interface DashboardCharts {
  daily: Array<{ day: string; sales: number; profit: number | null }>
  monthly: Array<{ month: string; sales: number; profit: number | null; purchases: number | null }>
  methods: Array<{ method: PaymentMethod; amount: number }>
  bestSellers: Array<{ product: string; qty: number; unit: string; sales: number }>
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--primary)', 'var(--muted-foreground)']
/** Axis ticks in whole taka, short: 12,500 → "12.5k". */
const tick = (poisha: number) => {
  const taka = poisha / 100
  return Math.abs(taka) >= 1000 ? `${Math.round(taka / 100) / 10}k` : String(Math.round(taka))
}
const money = (v: unknown) => formatMoney(Number(v), { fraction: 0 })
const axis = { fontSize: 11, fill: 'var(--muted-foreground)' }
const tooltipStyle = { contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }, labelStyle: { fontWeight: 600 } }

/** Charts from GET /api/dashboard/charts. Profit and purchase series appear only for roles that may see them. */
export function DashboardChartsView({ data }: { data: DashboardCharts }) {
  const t = useTranslations('dashboard.charts')
  const tm = useTranslations('paymentMethods')
  // Every one of the last 30 days, including days without sales.
  const today = todayDateOnly()
  const byDay = new Map(data.daily.map((d) => [d.day, d]))
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(today, i - 29)
    return { label: day.slice(8) + '/' + day.slice(5, 7), sales: byDay.get(day)?.sales ?? 0, profit: byDay.get(day)?.profit ?? 0 }
  })
  const showProfit = data.daily.some((d) => d.profit !== null) || data.monthly.some((m) => m.profit !== null)
  const showPurchases = data.monthly.some((m) => m.purchases !== null)
  const methodTotal = data.methods.reduce((s, m) => s + m.amount, 0)

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title={t('daily')}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={daily} margin={{ left: -10, right: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axis} interval={4} tickLine={false} />
            <YAxis tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} />
            <Tooltip formatter={money} {...tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
            <Bar dataKey="sales" name={t('sales')} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            {showProfit && <Bar dataKey="profit" name={t('profit')} fill="var(--chart-5)" radius={[4, 4, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={showPurchases ? t('monthlyVsPurchases') : t('monthly')}>
        {data.monthly.length === 0 ? (
          <Empty text={t('noData')} />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data.monthly} margin={{ left: -10, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" tick={axis} tickLine={false} />
              <YAxis tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} />
              <Tooltip formatter={money} {...tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name={t('sales')} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              {showPurchases && <Bar dataKey="purchases" name={t('purchases')} fill="var(--chart-2)" radius={[4, 4, 0, 0]} />}
              {showProfit && <Line dataKey="profit" name={t('profit')} stroke="var(--chart-5)" strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title={t('methods')}>
        {data.methods.length === 0 ? (
          <Empty text={t('noData')} />
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.methods.map((m) => ({ ...m, name: tm(m.method) }))} dataKey="amount" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {data.methods.map((m, i) => (
                    <Cell key={m.method} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={money} {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="grid gap-2 text-sm">
              {data.methods.map((m, i) => (
                <li key={m.method} className="flex items-center gap-2">
                  <span className="size-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />
                  <span className="font-medium">{tm(m.method)}</span>
                  <span className="ml-auto pl-4 font-semibold">{money(m.amount)}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground">{methodTotal ? Math.round((m.amount / methodTotal) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>

      <ChartCard title={t('best')}>
        {data.bestSellers.length === 0 ? (
          <Empty text={t('noData')} />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.bestSellers} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="product" width={110} tick={axis} tickLine={false} />
              <Tooltip
                {...tooltipStyle}
                cursor={{ fill: 'var(--muted)' }}
                formatter={(v, _n, item) => [`${money(v)} · ${formatQtyNumber(item.payload.qty)} ${item.payload.unit}`, t('sales')]}
              />
              <Bar dataKey="sales" fill="var(--chart-3)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">{text}</p>
}
