'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Award, CalendarClock, CalendarX2, Coins, LayoutDashboard, Package, Tags } from 'lucide-react'
import Link from 'next/link'
import { formatMoney } from '@/lib/money'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api-client'
import { formatDate } from '@/lib/datetime'
import { useSettings } from '@/hooks/use-settings'

interface DashboardData {
  activeProducts: number
  lowStockProducts: number
  categories: number
  brands: number
  stockValue: number | null
  expiringBatches: number
  expiredBatches: number
}

/**
 * Real figures from GET /api/dashboard. Sales, profit and cash statistics and the charts arrive in
 * Phase 7, once those modules record data. Inventory figures link to their pages.
 */
export function DashboardPage() {
  const settings = useSettings()
  const t = useTranslations('dashboard')
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') })

  return (
    <>
      <PageHeader icon={LayoutDashboard} title={t('title')} description={`${settings.shopName} · ${formatDate(Date.now())}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Package} tone="primary" label={t('activeProducts')} value={data?.activeProducts} />
        <Stat icon={AlertTriangle} tone="warning" label={t('lowStockProducts')} value={data?.lowStockProducts} />
        <Stat icon={Tags} tone="info" label={t('categories')} value={data?.categories} />
        <Stat icon={Award} tone="success" label={t('brands')} value={data?.brands} />
      </div>
      <h2 className="mt-8 mb-3 text-lg font-bold">{t('inventoryTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data?.stockValue !== null && (
          <Link href="/inventory" className="rounded-xl">
            <Stat icon={Coins} tone="primary" label={t('stockValue')} value={data ? formatMoney(data.stockValue ?? 0, { fraction: 0 }) : undefined} />
          </Link>
        )}
        <Link href="/batches" className="rounded-xl">
          <Stat icon={CalendarClock} tone="warning" label={t('expiringBatches')} value={data?.expiringBatches} />
        </Link>
        <Link href="/batches" className="rounded-xl">
          <Stat icon={CalendarX2} tone="danger" label={t('expiredBatches')} value={data?.expiredBatches} />
        </Link>
      </div>
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

function Stat({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: keyof typeof TONES; label: string; value: number | string | undefined }) {
  return (
    <Card className="relative gap-0 overflow-hidden py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={cn('absolute inset-x-0 top-0 h-1', TONES[tone].bar)} aria-hidden />
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl ring-1', TONES[tone].tile)}>
          <Icon className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          {value === undefined ? <Skeleton className="mt-1 h-8 w-14" /> : <p className="text-3xl font-bold tracking-tight">{value}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
