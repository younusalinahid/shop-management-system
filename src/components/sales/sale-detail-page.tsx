'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Ban, Printer, ReceiptText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PrintableReceipt, printNow, Receipt } from '@/components/pos/receipt'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import type { SaleDetail } from '@/lib/sales'
import { SaleStatusBadge } from './sales-page'

export function SaleDetailPage({ id }: { id: string }) {
  const t = useTranslations('saleDetail')
  const tm = useTranslations('paymentMethods')
  const settings = useSettings()
  const canCancel = usePermission('sales.cancel')
  const canProfit = usePermission('reports.profit')
  const [cancelling, setCancelling] = useState(false)
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => api.get<SaleDetail>(`/api/sales/${id}`) })

  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState title={t('loadError')} message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data

  return (
    <>
      <PageHeader
        icon={ReceiptText}
        title={s.invoiceNo}
        description={`${formatDateTime(s.createdAt)} · ${s.customerName || t('walkIn')}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sales">
                <ArrowLeft /> {t('back')}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => printNow()}>
              <Printer /> {t('print')}
            </Button>
            {canCancel && s.status === 'completed' && (
              <Button variant="destructive" onClick={() => setCancelling(true)}>
                <Ban /> {t('cancel')}
              </Button>
            )}
          </>
        }
      />
      {s.status === 'cancelled' && (
        <div role="status" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">{t('cancelledTitle')}</p>
          <p className="text-muted-foreground">
            {s.cancelledAt && formatDateTime(s.cancelledAt)} · {s.cancelReason}
          </p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('receipt')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-white py-2">
              <Receipt sale={s} settings={settings} />
            </div>
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t('summary')}</CardTitle>
              <SaleStatusBadge status={s.status} />
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Line label={t('total')} value={formatMoney(s.total)} strong />
              <Line label={t('paid')} value={formatMoney(s.paid)} />
              {s.due > 0 && <Line label={t('due')} value={formatMoney(s.due)} danger />}
              {s.changeGiven > 0 && <Line label={t('change')} value={formatMoney(s.changeGiven)} />}
              {canProfit && s.status !== 'cancelled' && (
                <>
                  <div className="my-1 border-t" />
                  <Line label={t('cost')} value={formatMoney(s.cogs)} />
                  <Line label={t('grossProfit')} value={formatMoney(s.total - s.taxTotal - s.cogs)} strong />
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('payments')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {s.payments.length === 0 && <p className="text-muted-foreground">{t('noPayments')}</p>}
              {s.payments.map((p) => (
                <Line key={p.id} label={`${tm(p.method)}${p.reference ? ` · ${p.reference}` : ''}`} value={formatMoney(p.amount)} />
              ))}
              <div className="my-1 border-t" />
              <Line label={t('cashier')} value={s.cashierName} />
              <Line label={t('priceMode')} value={t(s.priceMode)} />
              {s.note && <p className="rounded-md bg-muted px-3 py-2">{s.note}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
      <PrintableReceipt sale={s} settings={settings} />
      {cancelling && <CancelDialog sale={s} onClose={() => setCancelling(false)} onDone={() => void q.refetch()} />}
    </>
  )
}

function Line({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={danger ? 'font-bold text-destructive' : strong ? 'text-base font-bold' : 'font-medium'}>{value}</span>
    </div>
  )
}

function CancelDialog({ sale, onClose, onDone }: { sale: SaleDetail; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('saleDetail')
  const tc = useTranslations('common')
  const refresh = useRefreshData()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    if (!reason.trim()) return setError(t('reasonRequired'))
    setBusy(true)
    setError(undefined)
    try {
      await api.post(`/api/sales/${sale.id}/cancel`, { reason: reason.trim() })
      await refresh()
      toast.success(t('cancelledToast', { no: sale.invoiceNo }))
      onDone()
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
          <DialogTitle>{t('cancelTitle', { no: sale.invoiceNo })}</DialogTitle>
          <DialogDescription>{t('cancelText')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="sale-cancel-reason">{t('reason')}</Label>
          <Textarea id="sale-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? tc('working') : t('confirmCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
