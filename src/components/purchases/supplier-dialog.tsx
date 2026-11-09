'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import type { Supplier } from '@/lib/inventory'
import { tryParseMoney } from '@/lib/money'

/** Quick "new supplier" form used from the purchase screen. */
export function SupplierDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Supplier) => void }) {
  const t = useTranslations('supplier')
  const tc = useTranslations('common')
  const ids = useId()
  const refresh = useRefreshData()
  const [form, setForm] = useState({ name: '', companyName: '', phone: '', address: '', openingBalance: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setError(undefined)
    if (!form.name.trim()) return setError(t('nameRequired'))
    const opening = tryParseMoney(form.openingBalance || '0')
    if (opening === null || opening < 0) return setError(t('badAmount'))
    setBusy(true)
    try {
      const s = await api.post<Supplier>('/api/suppliers', { ...form, openingBalance: opening })
      await refresh()
      toast.success(t('createdToast', { name: s.name }))
      onCreated(s)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
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
          <DialogTitle>{t('newTitle')}</DialogTitle>
          <DialogDescription>{t('newText')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {field('name', t('name'), { autoFocus: true })}
          {field('companyName', t('company'))}
          <div className="grid grid-cols-2 gap-3">
            {field('phone', t('phone'), { inputMode: 'tel' })}
            {field('openingBalance', t('openingDue'), { inputMode: 'decimal', placeholder: '0' })}
          </div>
          {field('address', t('address'))}
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
