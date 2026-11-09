'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { Package, ReceiptText, Truck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StorageStatusCard } from '@/components/shared/storage-status-card'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { db } from '@/db/database'
import { formatDate, startOfDay } from '@/lib/datetime'
import { useSettings } from '@/hooks/use-settings'

/**
 * Phase 1 dashboard: real record counts read straight from IndexedDB.
 * Sales/profit statistics and charts arrive in Phase 7 once those modules exist.
 */
export function DashboardPage() {
  const settings = useSettings()
  const counts = useLiveQuery(async () => {
    const [products, customers, suppliers, salesToday] = await Promise.all([
      db.products.where('status').equals('active').count(),
      db.customers.where('status').equals('active').count(),
      db.suppliers.where('status').equals('active').count(),
      db.sales.where('createdAt').aboveOrEqual(startOfDay(Date.now())).count(),
    ])
    return { products, customers, suppliers, salesToday }
  }, [])

  return (
    <>
      <PageHeader title="Dashboard" description={`${settings.shopName} · ${formatDate(Date.now())}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={ReceiptText} label="Sales today" value={counts?.salesToday} />
        <Stat icon={Package} label="Active products" value={counts?.products} />
        <Stat icon={Users} label="Customers" value={counts?.customers} />
        <Stat icon={Truck} label="Suppliers" value={counts?.suppliers} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <StorageStatusCard />
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
