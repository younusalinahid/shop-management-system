'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Search, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { Pagination, usePagination } from '@/components/shared/pagination'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productUrl, purchaseUrl } from '@/constants/navigation'
import { useCatalog } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { addDays, daysBetween, formatDate, formatDateOnly, todayDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { type BatchRow, expiryState } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import { AdjustStockDialog } from './adjust-stock-dialog'
import { qtyText } from './qty'

type State = 'expiring' | 'expired' | 'in_stock' | 'all'

/** Batch-wise stock with expiry: what expires soon, what already expired, and write-offs. */
export function BatchesPage() {
  const t = useTranslations('batches')
  const catalog = useCatalog()
  const canAdjust = usePermission('inventory.adjust')
  const canViewCost = usePermission('products.view_cost')
  const [state, setState] = useState<State>('expiring')
  const [query, setQuery] = useState('')
  const [writeOff, setWriteOff] = useState<BatchRow | null>(null)

  const params = new URLSearchParams({ state })
  if (query.trim()) params.set('q', query.trim())
  const list = useQuery({ queryKey: ['batches', params.toString()], queryFn: () => api.get<{ items: BatchRow[]; warningDays: number }>(`/api/inventory/batches?${params}`) })
  const pager = usePagination(list.data?.items ?? [])
  const today = todayDateOnly()

  return (
    <>
      <PageHeader icon={CalendarClock} title={t('title')} description={t('description')} />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
          </div>
          <Tabs value={state} onValueChange={(v) => setState(v as State)}>
            <TabsList>
              <TabsTrigger value="expiring">{t('expiring', { days: list.data?.warningDays ?? 30 })}</TabsTrigger>
              <TabsTrigger value="expired">{t('expired')}</TabsTrigger>
              <TabsTrigger value="in_stock">{t('inStock')}</TabsTrigger>
              <TabsTrigger value="all">{t('all')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          </div>
        ) : list.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={CalendarClock} title={t(`empty.${state}`)} description={t('emptyText')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('batch')}</TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead>{t('expiry')}</TableHead>
                  <TableHead className="text-right">{t('remaining')}</TableHead>
                  {canViewCost && <TableHead className="hidden text-right md:table-cell">{t('value')}</TableHead>}
                  {canAdjust && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map((b) => {
                  const units = catalog?.unitsByProduct.get(b.productId) ?? []
                  const st = expiryState(b.expiryDate, today, list.data.warningDays, addDays)
                  const days = daysBetween(today, b.expiryDate)
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <p className="font-semibold">{b.batchNo}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('received', { date: formatDate(b.receivedAt) })}
                          {b.purchaseId && (
                            <>
                              {' · '}
                              <Link href={purchaseUrl(b.purchaseId)} className="text-primary hover:underline">
                                {t('purchase')}
                              </Link>
                            </>
                          )}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link href={productUrl(b.productId)} className="font-medium hover:text-primary hover:underline">
                          {b.productName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{b.sku}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {st === 'none' ? (
                          <span className="text-muted-foreground">{t('noExpiry')}</span>
                        ) : (
                          <>
                            <p className="font-medium">{formatDateOnly(b.expiryDate)}</p>
                            {st === 'expired' && <Badge variant="destructive">{t('expiredAgo', { days: -days })}</Badge>}
                            {st === 'soon' && <Badge variant="warning">{t('daysLeft', { days })}</Badge>}
                            {st === 'ok' && <span className="text-xs text-muted-foreground">{t('daysLeft', { days })}</span>}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <p className="font-semibold">{qtyText(b.qtyRemaining, units, b.baseUnitName)}</p>
                        <p className="text-xs text-muted-foreground">{t('of', { qty: qtyText(b.qtyReceived, units, b.baseUnitName) })}</p>
                      </TableCell>
                      {canViewCost && <TableCell className="hidden text-right md:table-cell">{formatMoney(b.remainingValue)}</TableCell>}
                      {canAdjust && (
                        <TableCell>
                          {b.qtyRemaining > 0 && (
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setWriteOff(b)}>
                              <Trash2 /> <span className="hidden md:inline">{t('writeOff')}</span>
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination {...pager} />
          </>
        )}
      </Card>
      {writeOff && (
        <AdjustStockDialog
          productId={writeOff.productId}
          batch={writeOff}
          defaultType={writeOff.expiryDate < today ? 'expired' : 'damaged'}
          onClose={() => setWriteOff(null)}
        />
      )}
    </>
  )
}
