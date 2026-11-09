'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Award, Package, Tags } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api-client'
import { formatDate } from '@/lib/datetime'
import { useSettings } from '@/hooks/use-settings'

interface DashboardData {
  activeProducts: number
  lowStockProducts: number
  categories: number
  brands: number
}

/**
 * Real figures from GET /api/dashboard. Sales, profit and cash statistics and the charts arrive in
 * Phase 7, once those modules record data.
 */
export function DashboardPage() {
  const settings = useSettings()
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') })

  return (
    <>
      <PageHeader title="Dashboard" description={`${settings.shopName} · ${formatDate(Date.now())}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Package} label="Active products" value={data?.activeProducts} />
        <Stat icon={AlertTriangle} label="Low-stock products" value={data?.lowStockProducts} />
        <Stat icon={Tags} label="Categories" value={data?.categories} />
        <Stat icon={Award} label="Brands" value={data?.brands} />
      </div>
    </>
  )
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          {value === undefined ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="text-2xl font-semibold">{value}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
