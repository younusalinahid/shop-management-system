'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Ban, Printer, Truck, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { productUrl } from '@/constants/navigation'
import { useRefreshData } from '@/hooks/use-catalog'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { formatDateOnly, formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { PurchaseDetail } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import { formatQty, formatQtyNumber } from '@/lib/units'
import { PurchaseStatusBadge } from './purchases-page'

export function PurchaseDetailPage({ id }: { id: string }) {
  const t = useTranslations('purchaseDetail')
  const tp = useTranslations('purchases')
  const settings = useSettings()
  const [cancelling, setCancelling] = useState(false)
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => api.get<PurchaseDetail>(`/api/purchases/${id}`) })

  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState title={t('loadError')} message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const p = q.data

  return (
    <>
      <PageHeader
        icon={Truck}
        title={p.purchaseNo}
        description={`${formatDateOnly(p.purchaseDate)} · ${p.supplierName || tp('noSupplier')}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/purchases">
                <ArrowLeft /> {t('back')}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> {t('print')}
            </Button>
            {(p.status === 'completed' || p.status === 'partially_returned') && (
              <Button variant="outline" asChild>
                <Link href={`/purchase-returns/new?purchase=${p.id}`}>
                  <Undo2 /> {t('returnItems')}
                </Link>
              </Button>
            )}
            {p.status === 'completed' && (
              <Button variant="destructive" onClick={() => setCancelling(true)}>
                <Ban /> {t('cancel')}
              </Button>
            )}
          </>
        }
      />

      {p.status === 'cancelled' && (
        <div role="status" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">{t('cancelledTitle')}</p>
          <p className="text-muted-foreground">
            {p.cancelledAt && formatDateTime(p.cancelledAt)} · {p.cancelReason}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="gap-0 py-0 print:border-0 print:shadow-none">
          <div className="hidden border-b p-4 print:block">
            <p className="text-lg font-bold">{settings.shopName}</p>
            <p className="text-sm">
              {t('printTitle')} {p.purchaseNo} · {formatDateOnly(p.purchaseDate)}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('product')}</TableHead>
                <TableHead className="text-right">{t('quantity')}</TableHead>
                <TableHead className="text-right">{t('unitCost')}</TableHead>
                <TableHead className="text-right">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <Link href={productUrl(it.productId)} className="font-semibold hover:text-primary hover:underline">
                      {it.productName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {it.sku}
                      {it.batchNo && ` · ${t('batch', { batch: it.batchNo })}`}
                      {it.expiryDate && ` · ${t('expires', { date: formatDateOnly(it.expiryDate) })}`}
                    </p>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <p className="font-medium">
                      {formatQtyNumber(it.quantity)} {it.unitName}
                    </p>
                    {it.unitFactor > 1 && <p className="text-xs text-muted-foreground">= {formatQty(it.baseQty, { name: it.baseUnitName, factor: 1 })}</p>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatMoney(it.unitCost)}</TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap">
                    {formatMoney(it.amount)}
                    {it.lineTotal !== it.amount && <p className="text-xs font-normal text-muted-foreground">{t('landed', { amount: formatMoney(it.lineTotal) })}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t('summary')}</CardTitle>
              <PurchaseStatusBadge status={p.status} />
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Line label={t('subtotal')} value={formatMoney(p.subtotal)} />
              {p.discount > 0 && <Line label={t('discount')} value={`− ${formatMoney(p.discount)}`} />}
              {p.additionalCost > 0 && <Line label={t('additionalCost')} value={`+ ${formatMoney(p.additionalCost)}`} />}
              <div className="flex items-center justify-between border-t pt-2 text-base">
                <span className="font-semibold">{t('total')}</span>
                <span className="text-xl font-bold">{formatMoney(p.total)}</span>
              </div>
              <Line label={t('paid')} value={formatMoney(p.paid)} />
              <Line label={t('due')} value={formatMoney(p.due)} strong={p.due > 0} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-2 pt-6 text-sm">
              <Line label={t('supplier')} value={p.supplierName || tp('noSupplier')} />
              {p.referenceNo && <Line label={t('reference')} value={p.referenceNo} />}
              <Line label={t('enteredBy')} value={p.userName} />
              <Line label={t('enteredAt')} value={formatDateTime(p.createdAt)} />
              {p.note && <p className="mt-2 rounded-md bg-muted px-3 py-2">{p.note}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
      {cancelling && <CancelDialog purchase={p} onClose={() => setCancelling(false)} onDone={() => void q.refetch()} />}
    </>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold text-destructive' : 'font-medium'}>{value}</span>
    </div>
  )
}

function CancelDialog({ purchase, onClose, onDone }: { purchase: PurchaseDetail; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('purchaseDetail')
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
      await api.post(`/api/purchases/${purchase.id}/cancel`, { reason: reason.trim() })
      await refresh()
      toast.success(t('cancelledToast', { no: purchase.purchaseNo }))
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
          <DialogTitle>{t('cancelTitle', { no: purchase.purchaseNo })}</DialogTitle>
          <DialogDescription>{t('cancelText')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-reason">{t('reason')}</Label>
          <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
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
