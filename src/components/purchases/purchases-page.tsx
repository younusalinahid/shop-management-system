'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { purchaseUrl } from '@/constants/navigation'
import { api } from '@/lib/api-client'
import { formatDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { Page, PurchaseSummary } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'

const PAGE_SIZE = 25

export function PurchaseStatusBadge({ status }: { status: PurchaseSummary['status'] }) {
  const t = useTranslations('purchases.status')
  return <Badge variant={status === 'cancelled' ? 'destructive' : status === 'completed' ? 'success' : 'warning'}>{t(status)}</Badge>
}

/** Purchase history; search, filters and paging run on the server. */
export function PurchasesPage() {
  const t = useTranslations('purchases')
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'completed' | 'cancelled'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (query.trim()) params.set('q', query.trim())
  if (status !== 'all') params.set('status', status)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const list = useQuery({
    queryKey: ['purchases', params.toString()],
    queryFn: () => api.get<Page<PurchaseSummary> & { totals: { total: number; due: number } }>(`/api/purchases?${params}`),
    placeholderData: keepPreviousData,
  })
  const first = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        icon={Truck}
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/purchases/new">
              <Plus /> {t('new')}
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-8" placeholder={t('search')} value={query} onChange={(e) => first(setQuery)(e.target.value)} aria-label={t('search')} />
            </div>
            <Input type="date" className="w-40" value={from} onChange={(e) => first(setFrom)(e.target.value)} aria-label={t('from')} />
            <span className="text-sm text-muted-foreground">–</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => first(setTo)(e.target.value)} aria-label={t('to')} />
          </div>
          <Tabs value={status} onValueChange={(v) => first(setStatus)(v as typeof status)}>
            <TabsList>
              <TabsTrigger value="all">{t('all')}</TabsTrigger>
              <TabsTrigger value="completed">{t('status.completed')}</TabsTrigger>
              <TabsTrigger value="cancelled">{t('status.cancelled')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {list.data && list.data.total > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b bg-muted/40 px-4 py-2 text-sm">
            <span>
              {t('count', { count: list.data.total })}
            </span>
            <span>
              {t('totalLabel')} <span className="font-semibold">{formatMoney(list.data.totals.total)}</span>
            </span>
            <span>
              {t('dueLabel')} <span className="font-semibold text-destructive">{formatMoney(list.data.totals.due)}</span>
            </span>
          </div>
        )}
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          </div>
        ) : list.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Truck}
              title={t('emptyTitle')}
              description={t('emptyText')}
              action={
                <Button asChild>
                  <Link href="/purchases/new">
                    <Plus /> {t('new')}
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('purchase')}</TableHead>
                  <TableHead>{t('supplier')}</TableHead>
                  <TableHead className="text-right">{t('total')}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t('paid')}</TableHead>
                  <TableHead className="text-right">{t('due')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('statusLabel')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(purchaseUrl(p.id))}>
                    <TableCell>
                      <Link href={purchaseUrl(p.id)} className="font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.purchaseNo}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateOnly(p.purchaseDate)} · {t('items', { count: p.itemCount })}
                      </p>
                    </TableCell>
                    <TableCell>
                      {p.supplierName || <span className="text-muted-foreground">{t('noSupplier')}</span>}
                      {p.referenceNo && <p className="text-xs text-muted-foreground">{t('ref', { ref: p.referenceNo })}</p>}
                    </TableCell>
                    <TableCell className={`text-right font-semibold whitespace-nowrap ${p.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>{formatMoney(p.total)}</TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">{formatMoney(p.paid)}</TableCell>
                    <TableCell className={`text-right whitespace-nowrap ${p.due > 0 && p.status !== 'cancelled' ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{formatMoney(p.due)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <PurchaseStatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ServerPager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
