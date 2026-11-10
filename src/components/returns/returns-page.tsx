'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, RotateCcw, Search, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { purchaseUrl, saleUrl } from '@/constants/navigation'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { Page } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import type { PurchaseReturnRecord, SaleReturnRecord } from '@/lib/parties'
import { formatQtyNumber } from '@/lib/units'
import type { ReturnKind } from './return-form-page'

const PAGE_SIZE = 25

/** Sales returns or purchase returns, newest first. */
export function ReturnsPage({ kind }: { kind: ReturnKind }) {
  const t = useTranslations('returns')
  const tk = useTranslations(`returns.${kind}`)
  const tm = useTranslations('paymentMethods')
  const canCreate = usePermission(kind === 'sale' ? 'returns.process' : 'purchases.manage')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (query.trim()) params.set('q', query.trim())
  const endpoint = kind === 'sale' ? '/api/sale-returns' : '/api/purchase-returns'
  const list = useQuery({
    queryKey: [`${kind}-returns`, params.toString()],
    queryFn: () => api.get<Page<SaleReturnRecord | PurchaseReturnRecord> & { totals: { total: number; refund: number } }>(`${endpoint}?${params}`),
    placeholderData: keepPreviousData,
  })
  const Icon = kind === 'sale' ? RotateCcw : Undo2
  const newUrl = kind === 'sale' ? '/sales-returns/new' : '/purchase-returns/new'

  return (
    <>
      <PageHeader
        icon={Icon}
        title={tk('title')}
        description={tk('description')}
        actions={
          canCreate && (
            <Button asChild>
              <Link href={newUrl}>
                <Plus /> {tk('new')}
              </Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="border-b p-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-8"
              placeholder={tk('search')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              aria-label={tk('search')}
            />
          </div>
        </div>
        {list.data && list.data.total > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b bg-muted/40 px-4 py-2 text-sm">
            <span>
              {t('totalLabel')} <span className="font-semibold">{formatMoney(list.data.totals.total)}</span>
            </span>
            <span>
              {tk('refundLabel')} <span className="font-semibold">{formatMoney(list.data.totals.refund)}</span>
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
            <EmptyState icon={Icon} title={tk('emptyTitle')} description={tk('emptyText')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('return')}</TableHead>
                  <TableHead>{t('items')}</TableHead>
                  <TableHead className="text-right">{t('total')}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t('settled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((r) => {
                  const isSale = 'invoiceNo' in r
                  const adjusted = isSale ? r.dueAdjusted : r.payableAdjusted
                  const money = isSale ? r.refund : r.refundReceived
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-semibold">{r.returnNo}</p>
                        <p className="text-xs text-muted-foreground">
                          <Link href={isSale ? saleUrl(r.saleId) : purchaseUrl(r.purchaseId)} className="text-primary hover:underline">
                            {isSale ? r.invoiceNo : r.purchaseNo}
                          </Link>{' '}
                          · {(isSale ? r.customerName : r.supplierName) || t('noParty')} · {formatDateTime(r.createdAt)}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.reason}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.items.map((i) => (
                          <p key={i.id}>
                            {i.productName} · {formatQtyNumber(i.quantity)} {i.unitName}
                            {'condition' in i && i.condition === 'damaged' && (
                              <Badge variant="destructive" className="ml-1">
                                {t('damaged')}
                              </Badge>
                            )}
                          </p>
                        ))}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">{formatMoney(r.total)}</TableCell>
                      <TableCell className="hidden text-right text-sm md:table-cell">
                        {adjusted > 0 && <p>{tk('adjusted', { amount: formatMoney(adjusted) })}</p>}
                        {money > 0 && <p>{tk('refunded', { amount: formatMoney(money), method: r.refundMethod ? tm(r.refundMethod) : '' })}</p>}
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
