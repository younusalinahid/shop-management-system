'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
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
import { daysBetween, formatDate, formatDateTime, todayDateOnly, toDateOnly } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
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
        <Stat href="/sales" icon={Banknote} tone="success" label={t('todaySales')} value={m(data?.todaySales)} hint={data && t('invoicesCount', { count: data.todayInvoices })} />
        <Stat href="/cash" icon={Wallet} tone="info" label={t('todayCollection')} value={m(data?.todayCollection)} />
        <Stat href="/expenses" icon={ReceiptText} tone="danger" label={t('todayExpenses')} value={m(data?.todayExpenses)} />
        {data?.todayProfit !== null && <Stat href="/cash" icon={TrendingUp} tone="primary" label={t('todayProfit')} value={m(data?.todayProfit)} hint={data && t('netProfit', { amount: formatMoney(data.todayNetProfit ?? 0, { fraction: 0 }) })} />}
      </Section>

      <Section title={t('partiesTitle')}>
        <Stat href="/customers" icon={Users} tone="info" label={t('customers')} value={data?.customers} />
        <Stat href="/customer-due" icon={HandCoins} tone="danger" label={t('customerDue')} value={m(data?.customerDue)} />
        {data?.supplierDue !== null && (
          <>
            <Stat href="/suppliers" icon={Truck} tone="primary" label={t('suppliers')} value={data?.suppliers} />
            <Stat href="/supplier-due" icon={WalletCards} tone="warning" label={t('supplierDue')} value={m(data?.supplierDue)} />
          </>
        )}
      </Section>

      <Section title={t('inventoryTitle')}>
        <Stat href="/products" icon={Package} tone="primary" label={t('activeProducts')} value={data?.activeProducts} />
        <Stat href="/inventory" icon={AlertTriangle} tone="warning" label={t('lowStockProducts')} value={data?.lowStockProducts} />
        <Stat href="/batches" icon={CalendarClock} tone="warning" label={t('expiringBatches')} value={data?.expiringBatches} />
        <Stat href="/batches" icon={CalendarX2} tone="danger" label={t('expiredBatches')} value={data?.expiredBatches} />
        {data?.stockValue !== null && <Stat href="/inventory" icon={Coins} tone="success" label={t('stockValue')} value={m(data?.stockValue)} />}
      </Section>

      <h2 className="mt-8 mb-3 text-lg font-bold">{t('chartsTitle')}</h2>
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
      <h2 className="mb-3 text-lg font-bold [&:not(:first-of-type)]:mt-8">{title}</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </>
  )
}

const TONES = {
  primary: { tile: 'bg-primary/10 text-primary ring-primary/20', bar: 'bg-primary' },
  warning: { tile: 'bg-warning/20 text-warning-foreground ring-warning/30 dark:text-warning', bar: 'bg-warning' },
  info: { tile: 'bg-info/10 text-info ring-info/20', bar: 'bg-info' },
  success: { tile: 'bg-success/10 text-success ring-success/20', bar: 'bg-success' },
  danger: { tile: 'bg-destructive/10 text-destructive ring-destructive/20', bar: 'bg-destructive' },
} as const

function Stat({ icon: Icon, tone, label, value, hint, href }: { icon: LucideIcon; tone: keyof typeof TONES; label: string; value: number | string | undefined; hint?: string; href?: string }) {
  const card = (
    <Card className="relative h-full gap-0 overflow-hidden py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={cn('absolute inset-x-0 top-0 h-1', TONES[tone].bar)} aria-hidden />
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl ring-1', TONES[tone].tile)}>
          <Icon className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          {value === undefined ? <Skeleton className="mt-1 h-8 w-20" /> : <p className="truncate text-2xl font-bold tracking-tight">{value}</p>}
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
  return href ? (
    <Link href={href} className="rounded-xl">
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
