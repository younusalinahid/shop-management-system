'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RotateCcw, Search, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { purchaseUrl, saleUrl } from '@/constants/navigation'
import { useCatalog, useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { formatDateOnly, formatDateTime } from '@/lib/datetime'
import { divRound } from '@/lib/decimal'
import { errorMessage } from '@/lib/errors'
import { newId } from '@/lib/id'
import type { Page, PurchaseDetail, PurchaseSummary } from '@/lib/inventory'
import { formatMoney } from '@/lib/money'
import { PAYMENT_METHODS, type SaleDetail, type SaleSummary } from '@/lib/sales'
import { fromBaseQty, toBaseQty } from '@/lib/units'
import type { PaymentMethod } from '@/types/db'

export type ReturnKind = 'sale' | 'purchase'

interface Line {
  id: string
  productId: string
  productName: string
  unitName: string
  unitFactor: number
  quantity: string
  baseQty: number
  returnedBaseQty: number
  lineTotal: number
}

/**
 * Return goods from one invoice (sale) or purchase. Each line shows how much can still be returned;
 * the money estimate uses the price actually paid on the document (after discounts).
 */
export function ReturnFormPage({ kind, docId }: { kind: ReturnKind; docId?: string }) {
  const t = useTranslations('returnForm')
  const tk = useTranslations(`returnForm.${kind}`)
  const tm = useTranslations('paymentMethods')
  const tc = useTranslations('common')
  const router = useRouter()
  const catalog = useCatalog()
  const refresh = useRefreshData()
  const key = useRef(newId())
  const [lookup, setLookup] = useState('')
  const [lookupError, setLookupError] = useState<string>()
  const [qty, setQty] = useState<Record<string, string>>({})
  const [condition, setCondition] = useState<Record<string, 'resalable' | 'damaged'>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const doc = useQuery({
    queryKey: [kind, docId],
    enabled: !!docId,
    queryFn: () => api.get<SaleDetail | PurchaseDetail>(kind === 'sale' ? `/api/sales/${docId}` : `/api/purchases/${docId}`),
  })
  const listPath = kind === 'sale' ? '/sales-returns' : '/purchase-returns'

  const find = async () => {
    setLookupError(undefined)
    const q = lookup.trim()
    if (!q) return
    try {
      const res = await api.get<Page<SaleSummary | PurchaseSummary>>(`${kind === 'sale' ? '/api/sales' : '/api/purchases'}?q=${encodeURIComponent(q)}&pageSize=5`)
      const exact = res.items.find((d) => ('invoiceNo' in d ? d.invoiceNo : d.purchaseNo).toLowerCase() === q.toLowerCase()) ?? (res.items.length === 1 ? res.items[0] : undefined)
      if (!exact) return setLookupError(tk('notFound', { no: q }))
      router.push(`${listPath}/new?${kind}=${exact.id}`)
    } catch (e) {
      setLookupError(errorMessage(e))
    }
  }

  const lines: Line[] = useMemo(() => (doc.data ? (doc.data.items as Line[]) : []), [doc.data])

  const view = lines.map((l) => {
    const remaining = l.baseQty - l.returnedBaseQty
    const unit = { name: l.unitName, factor: l.unitFactor }
    const product = catalog?.products.find((p) => p.id === l.productId)
    const typed = (qty[l.id] ?? '').trim()
    let base = 0
    let err: string | undefined
    if (typed) {
      try {
        base = toBaseQty(typed, unit, product?.allowFraction ?? true)
        if (base > remaining) err = t('tooMuch')
      } catch {
        err = t('badQty')
      }
    }
    // Estimate; the server settles the last poisha when a line is fully returned.
    const amount = base > 0 && !err ? divRound(BigInt(l.lineTotal) * BigInt(base), BigInt(l.baseQty)) : 0
    return { l, remaining, remainingText: fromBaseQty(remaining, unit), base, err, amount }
  })
  const total = view.reduce((s, v) => s + (v.err ? 0 : v.amount), 0)
  const chosen = view.filter((v) => v.base > 0 && !v.err)

  const submit = async () => {
    setError(undefined)
    if (view.some((v) => v.err)) return setError(t('fixLines'))
    if (chosen.length === 0) return setError(t('pickOne'))
    if (!reason.trim()) return setError(t('reasonRequired'))
    setBusy(true)
    try {
      const body =
        kind === 'sale'
          ? { idempotencyKey: key.current, saleId: docId, refundMethod: method, reason, items: chosen.map((v) => ({ saleItemId: v.l.id, quantity: qty[v.l.id].trim(), condition: condition[v.l.id] ?? 'resalable' })) }
          : { idempotencyKey: key.current, purchaseId: docId, refundMethod: method, reason, items: chosen.map((v) => ({ purchaseItemId: v.l.id, quantity: qty[v.l.id].trim() })) }
      const res = await api.post<{ returnNo: string; refund?: number; refundReceived?: number }>(kind === 'sale' ? '/api/sale-returns' : '/api/purchase-returns', body)
      await refresh()
      const money = res.refund ?? res.refundReceived ?? 0
      toast.success(money > 0 ? tk('savedRefund', { no: res.returnNo, amount: formatMoney(money) }) : tk('saved', { no: res.returnNo }))
      router.push(listPath)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const header = (
    <PageHeader
      icon={kind === 'sale' ? RotateCcw : Undo2}
      title={tk('title')}
      description={tk('description')}
      actions={
        <Button variant="outline" asChild>
          <Link href={listPath}>
            <ArrowLeft /> {tk('back')}
          </Link>
        </Button>
      }
    />
  )

  if (!docId) {
    return (
      <>
        {header}
        <Card className="max-w-lg">
          <CardContent className="grid gap-3 pt-6">
            <Label htmlFor="ret-lookup">{tk('lookupLabel')}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void find()
              }}
            >
              <Input id="ret-lookup" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={tk('lookupPlaceholder')} autoFocus />
              <Button type="submit">
                <Search /> {t('find')}
              </Button>
            </form>
            {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
            <p className="text-xs text-muted-foreground">{tk('lookupHint')}</p>
          </CardContent>
        </Card>
      </>
    )
  }
  if (doc.isPending) return <LoadingState />
  if (doc.isError) return <ErrorState message={errorMessage(doc.error)} onRetry={() => void doc.refetch()} />
  const d = doc.data
  const isSale = 'invoiceNo' in d
  const docNo = isSale ? d.invoiceNo : d.purchaseNo
  const party = isSale ? d.customerName : d.supplierName
  const blocked = d.status === 'cancelled' || d.status === 'returned'

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">
              <Link href={isSale ? saleUrl(d.id) : purchaseUrl(d.id)} className="text-primary hover:underline">
                {docNo}
              </Link>{' '}
              · {party || t('noParty')} · {isSale ? formatDateTime(d.createdAt) : formatDateOnly(d.purchaseDate)}
            </CardTitle>
          </CardHeader>
          {blocked ? (
            <div className="p-4">
              <EmptyState icon={RotateCcw} title={t('nothingLeft')} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="text-right">{t('canReturn')}</TableHead>
                  <TableHead className="w-28">{t('returnQty')}</TableHead>
                  {kind === 'sale' && <TableHead className="w-36">{t('condition')}</TableHead>}
                  <TableHead className="text-right">{t('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.map((v) => (
                  <TableRow key={v.l.id} className={v.remaining === 0 ? 'opacity-50' : undefined}>
                    <TableCell>
                      <p className="font-semibold">{v.l.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('bought', { qty: v.l.quantity, unit: v.l.unitName, amount: formatMoney(v.l.lineTotal) })}
                      </p>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {v.remainingText} {v.l.unitName}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={qty[v.l.id] ?? ''}
                        placeholder="0"
                        disabled={v.remaining === 0}
                        onChange={(e) => setQty((q) => ({ ...q, [v.l.id]: e.target.value }))}
                        aria-label={t('qtyFor', { name: v.l.productName })}
                        aria-invalid={!!v.err}
                      />
                      {v.err && <p className="mt-1 text-xs text-destructive">{v.err}</p>}
                    </TableCell>
                    {kind === 'sale' && (
                      <TableCell>
                        <Select value={condition[v.l.id] ?? 'resalable'} onValueChange={(c) => setCondition((s) => ({ ...s, [v.l.id]: c as 'resalable' | 'damaged' }))} disabled={v.remaining === 0}>
                          <SelectTrigger className="w-full" aria-label={t('conditionFor', { name: v.l.productName })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="resalable">{t('resalable')}</SelectItem>
                            <SelectItem value="damaged">{t('damaged')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                    <TableCell className="text-right font-semibold whitespace-nowrap">{v.base > 0 && !v.err ? formatMoney(v.amount) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {!blocked && (
          <Card className="self-start">
            <CardContent className="grid gap-4 pt-6">
              <div className="rounded-xl bg-primary/10 px-4 py-3 text-center">
                <p className="text-sm text-muted-foreground">{tk('totalLabel')}</p>
                <p className="text-3xl font-bold text-primary">{formatMoney(total)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{tk('settleHint')}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ret-method">{tk('refundMethod')}</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger id="ret-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {tm(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ret-reason">{t('reason')}</Label>
                <Textarea id="ret-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tk('reasonPlaceholder')} />
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button size="lg" disabled={busy} onClick={() => void submit()}>
                {busy ? tc('working') : tk('save')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
