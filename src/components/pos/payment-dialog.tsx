'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney, moneyToInput, tryParseMoney } from '@/lib/money'
import { PAYMENT_METHODS, settle } from '@/lib/sales'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/types/db'

export interface PaymentRow {
  method: PaymentMethod
  amount: string
  reference: string
}

/**
 * Take payment: one or more methods (split payment). Cash may be more than the total; the change is
 * shown. Whatever is left unpaid becomes the customer's due (a customer must be selected).
 */
export function PaymentDialog({
  total,
  hasCustomer,
  busy,
  error,
  onPay,
  onClose,
}: {
  total: number
  hasCustomer: boolean
  busy: boolean
  error?: string
  onPay: (payments: Array<{ method: PaymentMethod; amount: number; reference: string }>) => void
  onClose: () => void
}) {
  const t = useTranslations('payment')
  const tm = useTranslations('paymentMethods')
  const tc = useTranslations('common')
  const [rows, setRows] = useState<PaymentRow[]>([{ method: 'cash', amount: moneyToInput(total), reference: '' }])
  const [localError, setLocalError] = useState<string>()

  const parsed = rows.map((r) => ({ method: r.method, amount: tryParseMoney(r.amount || '0') }))
  const invalid = parsed.some((p) => p.amount === null)
  const s = settle(total, parsed.map((p) => ({ method: p.method, amount: p.amount ?? 0 })))
  const update = (i: number, patch: Partial<PaymentRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = () => {
    setLocalError(undefined)
    if (invalid) return setLocalError(t('badAmount'))
    if (s.nonCashTooMuch) return setLocalError(t('nonCashTooMuch'))
    if (s.due > 0 && !hasCustomer) return setLocalError(t('dueNeedsCustomer'))
    onPay(rows.map((r, i) => ({ method: r.method, amount: parsed[i].amount ?? 0, reference: r.reference.trim() })).filter((p) => p.amount > 0))
  }

  // Quick cash buttons: exact amount and the next round notes.
  const notes = [...new Set([total, ...[100_00, 500_00, 1000_00].map((n) => Math.ceil(total / n) * n)])].filter((n) => n >= total).slice(0, 4)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="rounded-xl bg-primary/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t('toPay')}</p>
            <p className="text-3xl font-bold text-primary">{formatMoney(total)}</p>
          </div>

          <div className="grid gap-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[8.5rem_1fr_auto] gap-2">
                <Select value={r.method} onValueChange={(v) => update(i, { method: v as PaymentMethod })}>
                  <SelectTrigger className="w-full" aria-label={t('method')}>
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
                <div className="grid gap-1">
                  <Input inputMode="decimal" className="text-right text-lg font-semibold" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} aria-label={t('amountFor', { method: tm(r.method) })} autoFocus={i === 0} onFocus={(e) => e.target.select()} />
                  {r.method !== 'cash' && <Input value={r.reference} onChange={(e) => update(i, { reference: e.target.value })} placeholder={t('reference')} aria-label={t('reference')} />}
                </div>
                <Button type="button" variant="ghost" size="icon" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('removeRow')}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { method: rs.some((x) => x.method === 'cash') ? 'bkash' : 'cash', amount: moneyToInput(Math.max(0, s.due)), reference: '' }])}>
                <Plus /> {t('split')}
              </Button>
              {rows.length === 1 && rows[0].method === 'cash' && (
                <>
                  <span className="text-xs text-muted-foreground">{t('cashGiven')}</span>
                  {notes.map((n) => (
                    <Button key={n} type="button" variant="secondary" size="sm" onClick={() => update(0, { amount: moneyToInput(n) })}>
                      {formatMoney(n, { fraction: 0 })}
                    </Button>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => update(0, { amount: '0' })}>
                    {t('nothing')}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('paid')}</span>
              <span className="font-semibold">{formatMoney(s.paid)}</span>
            </div>
            <div className={cn('flex justify-between text-base', s.change > 0 && 'font-bold text-success')}>
              <span>{t('change')}</span>
              <span>{formatMoney(s.change)}</span>
            </div>
            <div className={cn('flex justify-between', s.due > 0 && 'font-bold text-destructive')}>
              <span>{t('due')}</span>
              <span>{formatMoney(s.due)}</span>
            </div>
            {s.due > 0 && !hasCustomer && <p className="text-xs text-destructive">{t('dueNeedsCustomer')}</p>}
          </div>

          {(localError || error) && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {localError || error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="success" size="lg" disabled={busy}>
              {busy ? tc('working') : t('complete')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
