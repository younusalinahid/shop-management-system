'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import type { Customer } from '@/lib/sales'

/** Quick "new customer" form from the POS. */
export function CustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Customer) => void }) {
  const t = useTranslations('customer')
  const tc = useTranslations('common')
  const ids = useId()
  const refresh = useRefreshData()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [mode, setMode] = useState<'default' | 'retail' | 'wholesale'>('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    setError(undefined)
    if (!name.trim()) return setError(t('nameRequired'))
    setBusy(true)
    try {
      const c = await api.post<Customer>('/api/customers', { name, phone, address, ...(mode !== 'default' && { priceMode: mode }) })
      await refresh()
      toast.success(t('createdToast', { name: c.name }))
      onCreated(c)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

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
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-name`}>{t('name')}</Label>
            <Input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-phone`}>{t('phone')}</Label>
              <Input id={`${ids}-phone`} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-mode`}>{t('priceMode')}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-addr`}>{t('address')}</Label>
            <Input id={`${ids}-addr`} value={address} onChange={(e) => setAddress(e.target.value)} />
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
