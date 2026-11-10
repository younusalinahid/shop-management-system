'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Ban, CreditCard, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { Page } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import type { PaymentRecord } from '@/lib/parties'

const PAGE_SIZE = 25

/** Due collections and supplier payments, with void for mistakes. */
export function PaymentsPage() {
  const t = useTranslations('payments')
  const tm = useTranslations('paymentMethods')
  const canVoid = usePermission('cash.manage')
  const [party, setParty] = useState<'all' | 'customer' | 'supplier'>('all')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [voiding, setVoiding] = useState<PaymentRecord | null>(null)

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (party !== 'all') params.set('partyType', party)
  if (query.trim()) params.set('q', query.trim())
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const list = useQuery({
    queryKey: ['payments', params.toString()],
    queryFn: () => api.get<Page<PaymentRecord> & { totals: { in: number; out: number } }>(`/api/payments?${params}`),
    placeholderData: keepPreviousData,
  })
  const first = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader icon={CreditCard} title={t('title')} description={t('description')} />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-8" placeholder={t('search')} value={query} onChange={(e) => first(setQuery)(e.target.value)} aria-label={t('search')} />
            </div>
            <Input type="date" className="w-40" value={from} onChange={(e) => first(setFrom)(e.target.value)} aria-label={t('from')} />
            <span className="text-sm text-muted-foreground">–</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => first(setTo)(e.target.value)} aria-label={t('to')} />
          </div>
          <Tabs value={party} onValueChange={(v) => first(setParty)(v as typeof party)}>
            <TabsList>
              <TabsTrigger value="all">{t('all')}</TabsTrigger>
              <TabsTrigger value="customer">{t('fromCustomers')}</TabsTrigger>
              <TabsTrigger value="supplier">{t('toSuppliers')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {list.data && list.data.total > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b bg-muted/40 px-4 py-2 text-sm">
            <span>
              {t('received')} <span className="font-semibold text-success">{formatMoney(list.data.totals.in)}</span>
            </span>
            <span>
              {t('paidOut')} <span className="font-semibold text-destructive">{formatMoney(list.data.totals.out)}</span>
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
            <EmptyState icon={CreditCard} title={t('emptyTitle')} description={t('emptyText')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payment')}</TableHead>
                  <TableHead>{t('party')}</TableHead>
                  <TableHead>{t('method')}</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                  {canVoid && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((p) => (
                  <TableRow key={p.id} className={p.voidedAt ? 'opacity-60' : undefined}>
                    <TableCell>
                      <p className="font-semibold">{p.paymentNo}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(p.createdAt)} · {p.userName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Link href={`/${p.partyType === 'customer' ? 'customers' : 'suppliers'}/${p.partyId}`} className="font-medium hover:text-primary hover:underline">
                        {p.partyName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{t(`kind.${p.kind}`)}</p>
                    </TableCell>
                    <TableCell>
                      {tm(p.method)}
                      {p.reference && <p className="text-xs text-muted-foreground">{p.reference}</p>}
                    </TableCell>
                    <TableCell className={`text-right font-semibold whitespace-nowrap ${p.voidedAt ? 'line-through' : p.direction === 'in' ? 'text-success' : 'text-destructive'}`}>
                      {p.direction === 'in' ? '+' : '−'}
                      {formatMoney(p.amount)}
                      {p.voidedAt && (
                        <Badge variant="destructive" className="ml-2 no-underline">
                          {t('void')}
                        </Badge>
                      )}
                    </TableCell>
                    {canVoid && (
                      <TableCell>
                        {!p.voidedAt && (p.kind === 'due_collection' || p.kind === 'supplier_payment') && (
                          <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setVoiding(p)} aria-label={t('voidNamed', { no: p.paymentNo })}>
                            <Ban />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ServerPager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {voiding && <VoidDialog payment={voiding} onClose={() => setVoiding(null)} />}
    </>
  )
}

function VoidDialog({ payment, onClose }: { payment: PaymentRecord; onClose: () => void }) {
  const t = useTranslations('payments')
  const tc = useTranslations('common')
  const refresh = useRefreshData()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async () => {
    if (!reason.trim()) return setError(t('reasonRequired'))
    setBusy(true)
    try {
      await api.post(`/api/payments/${payment.id}/void`, { reason })
      await refresh()
      toast.success(t('voidedToast', { no: payment.paymentNo }))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('voidTitle', { no: payment.paymentNo })}</DialogTitle>
          <DialogDescription>{t('voidText', { amount: formatMoney(payment.amount), name: payment.partyName })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="void-reason">{t('reason')}</Label>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? tc('working') : t('confirmVoid')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
