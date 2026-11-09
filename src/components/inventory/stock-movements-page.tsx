'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { productUrl, purchaseUrl } from '@/constants/navigation'
import { useCatalog } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { MovementRow, Page } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import type { StockMovementType } from '@/types/db'
import { ProductPicker } from './product-picker'
import { qtyChangeText, qtyText } from './qty'

const TYPES: StockMovementType[] = ['opening', 'purchase', 'purchase_cancel', 'adjustment_increase', 'adjustment_decrease', 'damaged', 'lost', 'expired', 'sale', 'sale_return', 'purchase_return']
const PAGE_SIZE = 50

/** Every stock change ever recorded, newest first. Filtering and paging run on the server. */
export function StockMovementsPage() {
  const t = useTranslations('stockMovements')
  const tm = useTranslations('movement')
  const catalog = useCatalog()
  const canViewCost = usePermission('products.view_cost')
  const [productId, setProductId] = useState<string>()
  const [type, setType] = useState<string>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (productId) params.set('productId', productId)
  if (type !== 'all') params.set('type', type)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const list = useQuery({
    queryKey: ['movements', params.toString()],
    queryFn: () => api.get<Page<MovementRow>>(`/api/inventory/movements?${params}`),
    placeholderData: keepPreviousData,
  })
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader icon={ArrowLeftRight} title={t('title')} description={t('description')} />
      <Card className="gap-0 py-0">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto]">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t('product')}</Label>
            {catalog ? <ProductPicker catalog={catalog} value={productId} onChange={reset(setProductId)} allowAll placeholder={t('allProducts')} filter={() => true} /> : <Input disabled />}
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t('type')}</Label>
            <Select value={type} onValueChange={reset(setType)}>
              <SelectTrigger className="w-full" aria-label={t('type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allTypes')}</SelectItem>
                {TYPES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {tm(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mv-from" className="text-xs text-muted-foreground">{t('from')}</Label>
            <Input id="mv-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mv-to" className="text-xs text-muted-foreground">{t('to')}</Label>
            <Input id="mv-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          </div>
        </div>

        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          </div>
        ) : list.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ArrowLeftRight} title={t('emptyTitle')} description={t('emptyText')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead className="text-right">{t('change')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('balance')}</TableHead>
                  {canViewCost && <TableHead className="hidden text-right lg:table-cell">{t('value')}</TableHead>}
                  <TableHead className="hidden lg:table-cell">{t('details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((m) => {
                  const units = catalog?.unitsByProduct.get(m.productId) ?? []
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(m.createdAt)}
                        <p className="text-xs text-muted-foreground">{m.userName}</p>
                      </TableCell>
                      <TableCell>
                        <Link href={productUrl(m.productId)} className="font-medium hover:text-primary hover:underline">
                          {m.productName}
                        </Link>
                        {m.batchNo && <p className="text-xs text-muted-foreground">{t('batch', { batch: m.batchNo })}</p>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.qtyChange < 0 ? 'muted' : 'success'}>{tm(m.type)}</Badge>
                      </TableCell>
                      <TableCell className={`text-right font-semibold whitespace-nowrap ${m.qtyChange < 0 ? 'text-destructive' : 'text-success'}`}>
                        {qtyChangeText(m.qtyChange, units, m.baseUnitName)}
                      </TableCell>
                      <TableCell className="hidden text-right whitespace-nowrap md:table-cell">{qtyText(m.balanceAfter, units, m.baseUnitName)}</TableCell>
                      {canViewCost && <TableCell className="hidden text-right whitespace-nowrap lg:table-cell">{formatMoney(m.valueChange)}</TableCell>}
                      <TableCell className="hidden max-w-xs text-sm text-muted-foreground lg:table-cell">
                        {m.refType === 'purchase' && m.refId ? (
                          <Link href={purchaseUrl(m.refId)} className="font-medium text-primary hover:underline">
                            {m.reason}
                          </Link>
                        ) : (
                          m.reason
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ServerPager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
