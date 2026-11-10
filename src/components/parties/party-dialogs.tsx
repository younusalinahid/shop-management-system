'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { newId } from '@/lib/id'
import type { Supplier } from '@/lib/inventory'
import { formatMoney, moneyToInput, tryParseMoney } from '@/lib/money'
import type { Customer } from '@/lib/sales'
import { PAYMENT_METHODS } from '@/lib/sales'
import type { PaymentMethod } from '@/types/db'

export type PartyKind = 'customer' | 'supplier'
export type Party = Customer | Supplier
export const partyEndpoint = (kind: PartyKind) => (kind === 'customer' ? '/api/customers' : '/api/suppliers')

/** Add or edit a customer or supplier. The opening balance can only be set when adding. */
export function PartyFormDialog({ kind, party, onClose, onSaved }: { kind: PartyKind; party?: Party; onClose: () => void; onSaved?: (p: Party) => void }) {
  const t = useTranslations('parties')
  const tc = useTranslations('common')
  const ids = useId()
  const refresh = useRefreshData()
  const [form, setForm] = useState({
    name: party?.name ?? '',
    phone: party?.phone ?? '',
    address: party?.address ?? '',
    notes: party?.notes ?? '',
    companyName: (party as Supplier | undefined)?.companyName ?? '',
    priceMode: (party as Customer | undefined)?.priceMode ?? 'default',
    openingBalance: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setError(undefined)
    if (!form.name.trim()) return setError(t('nameRequired'))
    const opening = tryParseMoney(form.openingBalance || '0')
    if (opening === null || opening < 0) return setError(t('badAmount'))
    const body =
      kind === 'customer'
        ? { name: form.name, phone: form.phone, address: form.address, notes: form.notes, ...(form.priceMode !== 'default' && { priceMode: form.priceMode }), openingBalance: opening }
        : { name: form.name, companyName: form.companyName, phone: form.phone, address: form.address, notes: form.notes, openingBalance: opening }
    setBusy(true)
    try {
      const saved = party ? await api.put<Party>(`${partyEndpoint(kind)}/${party.id}`, body) : await api.post<Party>(partyEndpoint(kind), body)
      await refresh()
      toast.success(party ? t('updatedToast', { name: saved.name }) : t('createdToast', { name: saved.name }))
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const field = (k: keyof typeof form, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${ids}-${k}`}>{label}</Label>
      <Input id={`${ids}-${k}`} value={form[k]} onChange={set(k)} {...extra} />
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{party ? t(`${kind}.editTitle`) : t(`${kind}.newTitle`)}</DialogTitle>
          <DialogDescription>{t(`${kind}.formText`)}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {field('name', t('name'), { autoFocus: true })}
          {kind === 'supplier' && field('companyName', t('company'))}
          <div className="grid grid-cols-2 gap-3">
            {field('phone', t('phone'), { inputMode: 'tel' })}
            {kind === 'customer' ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-mode`}>{t('priceMode')}</Label>
                <Select value={form.priceMode} onValueChange={(v) => setForm((f) => ({ ...f, priceMode: v as typeof f.priceMode }))}>
                  <SelectTrigger id={`${ids}-mode`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{t('modeDefault')}</SelectItem>
                    <SelectItem value="retail">{t('modeRetail')}</SelectItem>
                    <SelectItem value="wholesale">{t('modeWholesale')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              !party && field('openingBalance', t('supplier.opening'), { inputMode: 'decimal', placeholder: '0' })
            )}
          </div>
          {kind === 'customer' && !party && field('openingBalance', t('customer.opening'), { inputMode: 'decimal', placeholder: '0' })}
          {field('address', t('address'))}
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-notes`}>{t('notes')}</Label>
            <Textarea id={`${ids}-notes`} rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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

/** Collect a customer's due, or pay a supplier. Defaults to the full balance. */
export function PartyPaymentDialog({ kind, party, onClose }: { kind: PartyKind; party: Party; onClose: () => void }) {
  const t = useTranslations('parties')
  const tm = useTranslations('paymentMethods')
  const tc = useTranslations('common')
  const ids = useId()
  const refresh = useRefreshData()
  const key = useRef(newId())
  const [amount, setAmount] = useState(moneyToInput(party.balance))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    setError(undefined)
    const value = tryParseMoney(amount)
    if (value === null || value <= 0) return setError(t('badAmount'))
    if (value > party.balance) return setError(t(`${kind}.tooMuch`, { amount: formatMoney(party.balance) }))
    setBusy(true)
    try {
      await api.post(kind === 'customer' ? '/api/payments/collect' : '/api/payments/supplier', { idempotencyKey: key.current, partyId: party.id, amount: value, method, reference, note })
      await refresh()
      toast.success(t(`${kind}.paidToast`, { amount: formatMoney(value), name: party.name }))
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
          <DialogTitle>{t(`${kind}.payTitle`, { name: party.name })}</DialogTitle>
          <DialogDescription>{t(`${kind}.balanceNow`, { amount: formatMoney(party.balance) })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-amount`}>{t('amount')}</Label>
              <Input id={`${ids}-amount`} inputMode="decimal" className="text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-method`}>{t('method')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id={`${ids}-method`} className="w-full">
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
          </div>
          {method !== 'cash' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-ref`}>{t('reference')}</Label>
              <Input id={`${ids}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-note`}>{t('note')}</Label>
            <Input id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy ? tc('working') : t(`${kind}.paySave`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
