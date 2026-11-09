'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ID } from '@/types/db'
import { mulToInteger, parseDecimal } from '@/lib/decimal'
import { parseMoney } from '@/lib/money'
import { errorMessage } from '@/lib/errors'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import type { BulkPriceInput } from '@/lib/product'

/** Raise or lower one price field across the selected products, in one atomic, audited update. */
export function BulkPriceDialog({ productIds, canViewCost, onClose }: { productIds: ID[]; canViewCost: boolean; onClose: (done: boolean) => void }) {
  const refresh = useRefreshData()
  const t = useTranslations('bulkPrice')
  const [field, setField] = useState<BulkPriceInput['field']>('retailPrice')
  const [scope, setScope] = useState<BulkPriceInput['scope']>('all')
  const [method, setMethod] = useState<BulkPriceInput['method']>('percent')
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [amount, setAmount] = useState('')
  const [roundTo, setRoundTo] = useState<'1' | '100'>('1')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Signed value for the service, or an error message. */
  const parseValue = (): number | string => {
    let v: number
    try {
      const d = parseDecimal(amount)
      if (d.units <= 0n) return t('amountPositive')
      v = method === 'percent' ? mulToInteger(d, 100, 'exact') : parseMoney(amount)
    } catch {
      return t('amountInvalid')
    }
    if (method === 'percent' && direction === 'down' && v >= 10000) return t('decreaseTooLarge')
    return direction === 'up' ? v : -v
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = parseValue()
    if (typeof value === 'string') {
      setError(value)
      return
    }
    setBusy(true)
    try {
      const body: BulkPriceInput = { productIds, field, scope, method, value, roundTo: Number(roundTo) as 1 | 100, reason: reason || undefined }
      const { changed: n } = await api.post<{ changed: number }>('/api/products/bulk-price', body)
      await refresh()
      toast.success(n === 0 ? t('noneChanged') : t('updated', { count: n }))
      onClose(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose(false)}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {t('description', { count: productIds.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('price')}>
              <Select value={field} onValueChange={(v) => setField(v as typeof field)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retailPrice">{t('retailPrice')}</SelectItem>
                  <SelectItem value="wholesalePrice">{t('wholesalePrice')}</SelectItem>
                  {canViewCost && <SelectItem value="purchasePrice">{t('purchasePrice')}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('units')}>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('everyUnit')}</SelectItem>
                  <SelectItem value="base">{t('baseOnly')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('change')}>
              <div className="flex gap-2">
                <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up">{t('increase')}</SelectItem>
                    <SelectItem value="down">{t('decrease')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">{t('byPercent')}</SelectItem>
                    <SelectItem value="amount">{t('byAmount')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field label={method === 'percent' ? t('percent') : t('amountPerUnit')}>
              <Input inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} placeholder={method === 'percent' ? '5' : '2.50'} />
            </Field>
            <Field label={t('rounding')}>
              <Select value={roundTo} onValueChange={(v) => setRoundTo(v as typeof roundTo)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('keepPoisha')}</SelectItem>
                  <SelectItem value="100">{t('wholeTaka')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('reason')}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} maxLength={200} />
            </Field>
          </div>
          {method === 'percent' && <p className="text-xs text-muted-foreground">{t('zeroHint')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy || !amount}>
              {busy ? t('updating') : t('title')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
