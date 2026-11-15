'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CalendarX2,
  Coins,
  HandCoins,
  LayoutDashboard,
  Package,
  ReceiptText,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  WalletCards,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { qtyChangeText } from '@/components/inventory/qty'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { purchaseUrl, saleUrl } from '@/constants/navigation'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { addDays, daysBetween, formatDate, formatDateTime, todayDateOnly, toDateOnly } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { HUES, type HueName } from '@/lib/section-colors'
import type { StockMovementType } from '@/types/db'
import { type DashboardCharts, DashboardChartsView } from './dashboard-charts'

interface DashboardData {
  activeProducts: number
  lowStockProducts: number
  categories: number
  brands: number
  customers: number
  suppliers: number
  customerDue: number
  supplierDue: number | null
  stockValue: number | null
  expiringBatches: number
  expiredBatches: number
  todaySales: number
  todayInvoices: number
  todayDue: number
  todayCollection: number
  todayExpenses: number
  todayProfit: number | null
  todayNetProfit: number | null
  recentSales: Array<{ id: string; invoiceNo: string; customerName: string; total: number; due: number; createdAt: number }>
  recentPurchases: Array<{ id: string; purchaseNo: string; supplierName: string; total: number; createdAt: number }>
  recentMovements: Array<{ id: string; type: StockMovementType; qtyChange: number; createdAt: number; productId: string; productName: string; baseUnitName: string }>
}

/** Business overview from GET /api/dashboard and /api/dashboard/charts. Every number comes from recorded documents. */
export function DashboardPage() {
  const settings = useSettings()
  const t = useTranslations('dashboard')
  const tm = useTranslations('movement')
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') })
  const charts = useQuery({ queryKey: ['dashboard-charts'], queryFn: () => api.get<DashboardCharts>('/api/dashboard/charts') })
  const canBackup = usePermission('backup.manage')
  const backupDue = canBackup && settings.updatedAt > 0 && (!settings.lastBackupAt || daysBetween(toDateOnly(settings.lastBackupAt), todayDateOnly()) >= settings.autoBackupReminderDays)
  // Today against yesterday, from the last 30 days of recorded sales.
  const days = charts.data?.daily ?? []
  const yesterdayKey = addDays(todayDateOnly(), -1)
  const dayOf = (key: string) => days.find((d) => d.day === key)
  const salesTrend = pctChange(data?.todaySales, dayOf(yesterdayKey)?.sales)
  const profitTrend = pctChange(data?.todayProfit, dayOf(yesterdayKey)?.profit)
  const lastDays = Array.from({ length: 14 }, (_, i) => dayOf(addDays(todayDateOnly(), i - 13)))
  const salesSpark = days.length ? lastDays.map((d) => d?.sales ?? 0) : undefined
  const profitSpark = days.some((d) => d.profit !== null) ? lastDays.map((d) => d?.profit ?? 0) : undefined
  const vs = t('vsYesterday')
  const m = (v: number | null | undefined) => (v === undefined || v === null ? undefined : formatMoney(v, { fraction: 0 }))

  return (
    <>
      <PageHeader icon={LayoutDashboard} title={t('title')} description={`${settings.shopName} · ${formatDate(Date.now())}`} />
      {backupDue && (
        <Link href="/backup" className="mb-6 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium transition-colors hover:bg-warning/20">
          <AlertTriangle className="size-5 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
          {settings.lastBackupAt ? t('backupOld', { date: formatDate(settings.lastBackupAt) }) : t('backupNever')}
        </Link>
      )}

      <Section title={t('todayTitle')}>
        <Stat href="/sales" icon={Banknote} tone="emerald" label={t('todaySales')} value={m(data?.todaySales)} hint={data && t('invoicesCount', { count: data.todayInvoices })} trend={salesTrend === null ? null : { pct: salesTrend, label: vs }} spark={salesSpark} />
        <Stat href="/cash" icon={Wallet} tone="sky" label={t('todayCollection')} value={m(data?.todayCollection)} />
        <Stat href="/expenses" icon={ReceiptText} tone="rose" label={t('todayExpenses')} value={m(data?.todayExpenses)} />
        {data?.todayProfit !== null && <Stat href="/cash" icon={TrendingUp} tone="violet" label={t('todayProfit')} value={m(data?.todayProfit)} hint={data && t('netProfit', { amount: formatMoney(data.todayNetProfit ?? 0, { fraction: 0 }) })} trend={profitTrend === null ? null : { pct: profitTrend, label: vs }} spark={profitSpark} />}
      </Section>

      <Section title={t('partiesTitle')}>
        <Stat href="/customers" icon={Users} tone="pink" label={t('customers')} value={data?.customers} />
        <Stat href="/customer-due" icon={HandCoins} tone="rose" label={t('customerDue')} value={m(data?.customerDue)} />
        {data?.supplierDue !== null && (
          <>
            <Stat href="/suppliers" icon={Truck} tone="sky" label={t('suppliers')} value={data?.suppliers} />
            <Stat href="/supplier-due" icon={WalletCards} tone="amber" label={t('supplierDue')} value={m(data?.supplierDue)} />
          </>
        )}
      </Section>

      <Section title={t('inventoryTitle')}>
        <Stat href="/products" icon={Package} tone="violet" label={t('activeProducts')} value={data?.activeProducts} />
        <Stat href="/inventory" icon={AlertTriangle} tone="amber" label={t('lowStockProducts')} value={data?.lowStockProducts} />
        <Stat href="/batches" icon={CalendarClock} tone="amber" label={t('expiringBatches')} value={data?.expiringBatches} />
        <Stat href="/batches" icon={CalendarX2} tone="rose" label={t('expiredBatches')} value={data?.expiredBatches} />
        {data?.stockValue !== null && <Stat href="/inventory" icon={Coins} tone="teal" label={t('stockValue')} value={m(data?.stockValue)} />}
      </Section>

      <h2 className="mt-8 mb-3 text-xs font-bold tracking-widest text-slate-600 uppercase dark:text-slate-300">{t('chartsTitle')}</h2>
      {charts.data ? <DashboardChartsView data={charts.data} /> : <Skeleton className="h-72 w-full rounded-xl" />}

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <ListCard title={t('recentSales')} href="/sales" more={t('seeAll')} empty={t('nothingYet')}>
          {data?.recentSales.map((s) => (
            <Row key={s.id} href={saleUrl(s.id)} title={s.invoiceNo} sub={`${s.customerName || t('walkIn')} · ${formatDateTime(s.createdAt)}`} value={formatMoney(s.total)} danger={s.due > 0} />
          ))}
        </ListCard>
        {data?.supplierDue !== null && (
          <ListCard title={t('recentPurchases')} href="/purchases" more={t('seeAll')} empty={t('nothingYet')}>
            {data?.recentPurchases.map((p) => (
              <Row key={p.id} href={purchaseUrl(p.id)} title={p.purchaseNo} sub={`${p.supplierName || '—'} · ${formatDateTime(p.createdAt)}`} value={formatMoney(p.total)} />
            ))}
          </ListCard>
        )}
        <ListCard title={t('recentMovements')} href="/stock-movements" more={t('seeAll')} empty={t('nothingYet')}>
          {data?.recentMovements.map((mv) => (
            <Row
              key={mv.id}
              href={`/products/${mv.productId}`}
              title={mv.productName}
              sub={`${tm(mv.type)} · ${formatDateTime(mv.createdAt)}`}
              value={qtyChangeText(mv.qtyChange, [{ name: mv.baseUnitName, factor: 1 }], mv.baseUnitName)}
              danger={mv.qtyChange < 0}
            />
          ))}
        </ListCard>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h2 className="mb-3 text-xs font-bold tracking-widest text-slate-600 uppercase dark:text-slate-300 [&:not(:first-of-type)]:mt-8">{title}</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </>
  )
}

const TONES = HUES

/** Percent change from yesterday to today, or null when yesterday has nothing to compare with. */
function pctChange(today: number | null | undefined, yesterday: number | null | undefined): number | null {
  if (today === null || today === undefined || !yesterday || yesterday <= 0) return null
  return Math.round(((today - yesterday) / yesterday) * 100)
}

function Trend({ pct, label }: { pct: number; label: string }) {
  const up = pct >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <p className="mt-2.5 flex items-center gap-1.5 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold', up ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')}>
        <Icon className="size-3" aria-hidden />
        {up ? '+' : ''}
        {pct}%
      </span>
      <span className="truncate font-semibold text-slate-600 dark:text-slate-400">{label}</span>
    </p>
  )
}

/** Tiny area line of the last days; the last point is emphasized. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2 || Math.max(...values) <= 0) return null
  const w = 96
  const h = 32
  const max = Math.max(...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-8 w-24 overflow-visible', className)} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="currentColor" opacity="0.12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--card)" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function Stat({ icon: Icon, tone, label, value, hint, href, trend, spark }: { icon: LucideIcon; tone: HueName; label: string; value: number | string | undefined; hint?: string; href?: string; trend?: { pct: number; label: string } | null; spark?: number[] }) {
  const hue = TONES[tone]
  const card = (
    <Card className="group relative h-full gap-0 overflow-hidden py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <div className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', hue.line)} aria-hidden />
      <div className={cn('pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-gradient-to-br blur-2xl transition-opacity duration-300 group-hover:opacity-100', hue.glow, 'opacity-70')} aria-hidden />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate pt-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</p>
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', hue.solid)}>
            <Icon className="size-5" strokeWidth={1.85} aria-hidden />
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {value === undefined ? <Skeleton className="h-9 w-28" /> : <p className="font-display truncate text-[26px] leading-none font-extrabold tracking-tight text-slate-950 tabular-nums dark:text-white">{value}</p>}
            {trend ? <Trend pct={trend.pct} label={trend.label} /> : hint ? <p className="mt-2.5 truncate text-xs font-semibold text-slate-600 dark:text-slate-400">{hint}</p> : null}
          </div>
          {spark && <Sparkline values={spark} className={hue.spark} />}
        </div>
      </CardContent>
    </Card>
  )
  return href ? (
    <Link href={href} className="rounded-2xl">
      {card}
    </Link>
  ) : (
    card
  )
}

function ListCard({ title, href, more, empty, children }: { title: string; href: string; more: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : []
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {more}
        </Link>
      </CardHeader>
      <ul className="divide-y">{items.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{empty}</li> : children}</ul>
    </Card>
  )
}

function Row({ href, title, sub, value, danger }: { href: string; title: string; sub: string; value: string; danger?: boolean }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-primary/5">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
        <span className={cn('shrink-0 font-semibold', danger && 'text-destructive')}>{value}</span>
      </Link>
    </li>
  )
}
