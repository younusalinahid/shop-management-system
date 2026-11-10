'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Banknote, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { purchaseUrl, saleUrl } from '@/constants/navigation'
import { useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { formatDateTime, todayDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { CashBook, CashEvent, ProfitAndLoss } from '@/lib/finance'
import { formatMoney, tryParseMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Cash book (every money movement by method) and the profit & loss for a date range. */
export function CashPage() {
  const t = useTranslations('cash')
  const canProfit = usePermission('reports.profit')
  const [tab, setTab] = useState<'book' | 'profit'>('book')
  const [from, setFrom] = useState(todayDateOnly())
  const [to, setTo] = useState(todayDateOnly())
  const [moving, setMoving] = useState<'cash_in' | 'cash_out' | null>(null)

  return (
    <>
      <PageHeader
        icon={Banknote}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button variant="outline" onClick={() => setMoving('cash_in')}>
              <ArrowDownLeft /> {t('cashIn')}
            </Button>
            <Button variant="outline" onClick={() => setMoving('cash_out')}>
              <ArrowUpRight /> {t('cashOut')}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="book">{t('book')}</TabsTrigger>
            {canProfit && <TabsTrigger value="profit">{t('profit')}</TabsTrigger>}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('from')} />
          <span className="text-sm text-muted-foreground">–</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('to')} />
        </div>
      </div>
      {tab === 'book' ? <Book from={from} to={to} /> : <ProfitView from={from} to={to} />}
      {moving && <MoveDialog type={moving} onClose={() => setMoving(null)} />}
    </>
  )
}

function Book({ from, to }: { from: string; to: string }) {
  const t = useTranslations('cash')
  const tm = useTranslations('paymentMethods')
  const q = useQuery({ queryKey: ['cash', from, to], queryFn: () => api.get<CashBook>(`/api/cash?from=${from}&to=${to}`) })
  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const b = q.data
  const link = (e: CashEvent) =>
    e.refId && (e.kind === 'sale' || e.kind === 'sale_cancel' || e.kind === 'sale_refund') ? saleUrl(e.refId) : e.refId && (e.kind === 'purchase' || e.kind === 'purchase_cancel' || e.kind === 'purchase_refund') ? purchaseUrl(e.refId) : undefined
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-0 py-0">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">{t('inDrawer')}</p>
            <p className="text-3xl font-bold text-primary">{formatMoney(b.cashInDrawer)}</p>
            <p className="text-xs text-muted-foreground">{t('inDrawerHint')}</p>
          </CardContent>
        </Card>
        {b.byMethod.map((m) => (
          <Card key={m.method} className="gap-0 py-0">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">{tm(m.method)}</p>
              <p className="text-2xl font-bold">{formatMoney(m.in - m.out)}</p>
              <p className="text-xs">
                <span className="text-success">+{formatMoney(m.in)}</span> · <span className="text-destructive">−{formatMoney(m.out)}</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="gap-0 py-0">
        {b.events.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Banknote} title={t('emptyTitle')} description={t('emptyText')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('time')}</TableHead>
                <TableHead>{t('what')}</TableHead>
                <TableHead>{t('method')}</TableHead>
                <TableHead className="text-right">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.events.map((e, i) => {
                const url = link(e)
                return (
                  <TableRow key={`${e.kind}-${e.refId ?? i}-${i}`}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(e.at)}
                      <p className="text-xs text-muted-foreground">{e.userName}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{t(`kind.${e.kind}`)}</p>
                      <p className="text-xs text-muted-foreground">
                        {url ? (
                          <Link href={url} className="text-primary hover:underline">
                            {e.ref}
                          </Link>
                        ) : (
                          e.ref
                        )}
                        {e.note && `${e.ref ? ' · ' : ''}${e.note}`}
                      </p>
                    </TableCell>
                    <TableCell>{tm(e.method)}</TableCell>
                    <TableCell className={cn('text-right font-semibold whitespace-nowrap', e.direction === 'in' ? 'text-success' : 'text-destructive')}>
                      {e.direction === 'in' ? '+' : '−'}
                      {formatMoney(e.amount)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

export function ProfitView({ from, to }: { from: string; to: string }) {
  const t = useTranslations('profit')
  const te = useTranslations('expenses.categories')
  const q = useQuery({ queryKey: ['profit', from, to], queryFn: () => api.get<ProfitAndLoss>(`/api/reports/profit?from=${from}&to=${to}`) })
  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const p = q.data
  const row = (label: string, value: number, opts: { sign?: '+' | '−'; strong?: boolean; indent?: boolean } = {}) => (
    <div className={cn('flex justify-between gap-3 py-1.5', opts.strong && 'border-t pt-2 text-base font-bold', opts.indent && 'pl-4 text-muted-foreground')}>
      <span>{label}</span>
      <span className={cn(opts.strong && (value < 0 ? 'text-destructive' : 'text-success'))}>
        {opts.sign && value !== 0 ? `${opts.sign} ` : ''}
        {formatMoney(value)}
      </span>
    </div>
  )
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-primary" /> {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {row(t('sales', { count: p.salesCount }), p.sales)}
          {row(t('returns'), p.returns, { sign: '−' })}
          {row(t('netSales'), p.netSales, { strong: true })}
          {row(t('cogs'), p.costOfGoods, { sign: '−' })}
          {row(t('grossProfit'), p.grossProfit, { strong: true })}
          {row(t('stockLoss'), p.stockLoss, { sign: '−' })}
          {row(t('expenses'), p.expenses, { sign: '−' })}
          {p.expensesByCategory.map((c) => (
            <div key={c.category}>{row((['rent', 'salary', 'electricity', 'internet', 'transport', 'maintenance', 'tea_snacks', 'other'] as string[]).includes(c.category) ? te(c.category) : c.category, c.amount, { indent: true })}</div>
          ))}
          {row(t('netProfit'), p.netProfit, { strong: true })}
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardContent className="grid gap-2 pt-6 text-sm">
          <p className="text-muted-foreground">{t('vatCollected')}</p>
          <p className="text-2xl font-bold">{formatMoney(p.vat)}</p>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
        </CardContent>
      </Card>
    </div>
  )
}

function MoveDialog({ type, onClose }: { type: 'cash_in' | 'cash_out'; onClose: () => void }) {
  const t = useTranslations('cash')
  const tc = useTranslations('common')
  const refresh = useRefreshData()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async () => {
    const value = tryParseMoney(amount)
    if (value === null || value <= 0) return setError(t('badAmount'))
    if (!reason.trim()) return setError(t('reasonRequired'))
    setBusy(true)
    try {
      await api.post('/api/cash/movements', { type, amount: value, reason })
      await refresh()
      toast.success(t(`${type}Toast`, { amount: formatMoney(value) }))
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
          <DialogTitle>{t(type === 'cash_in' ? 'cashInTitle' : 'cashOutTitle')}</DialogTitle>
          <DialogDescription>{t(type === 'cash_in' ? 'cashInText' : 'cashOutText')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="move-amount">{t('amount')}</Label>
            <Input id="move-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="move-reason">{t('reason')}</Label>
            <Input id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(type === 'cash_in' ? 'cashInPlaceholder' : 'cashOutPlaceholder')} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tc('working') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
