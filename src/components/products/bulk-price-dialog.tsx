import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ID } from '@/types/db'
import { mulToInteger, parseDecimal } from '@/lib/decimal'
import { parseMoney } from '@/lib/money'
import { errorMessage } from '@/services/errors'
import { type BulkPriceInput, bulkUpdatePrices } from '@/services/product-service'
import { currentActor } from '@/stores/session-store'

/** Raise or lower one price field across the selected products, in one atomic, audited update. */
export function BulkPriceDialog({ productIds, canViewCost, onClose }: { productIds: ID[]; canViewCost: boolean; onClose: (done: boolean) => void }) {
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
      if (d.units <= 0n) return 'Enter an amount greater than zero.'
      v = method === 'percent' ? mulToInteger(d, 100, 'exact') : parseMoney(amount)
    } catch {
      return 'Enter a valid number with up to 2 decimals.'
    }
    if (method === 'percent' && direction === 'down' && v >= 10000) return 'A decrease must be less than 100%.'
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
      const n = await bulkUpdatePrices(currentActor(), { productIds, field, scope, method, value, roundTo: Number(roundTo) as 1 | 100, reason })
      toast.success(n === 0 ? 'No prices changed' : `${n} unit price(s) updated`)
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
            <DialogTitle>Update prices</DialogTitle>
            <DialogDescription>
              Applies to {productIds.length} selected product(s). All changes are saved together and recorded in the audit log. Past invoices are not affected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price">
              <Select value={field} onValueChange={(v) => setField(v as typeof field)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retailPrice">Retail price</SelectItem>
                  <SelectItem value="wholesalePrice">Wholesale price</SelectItem>
                  {canViewCost && <SelectItem value="purchasePrice">Purchase price</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Units">
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every unit</SelectItem>
                  <SelectItem value="base">Base unit only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Change">
              <div className="flex gap-2">
                <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up">Increase</SelectItem>
                    <SelectItem value="down">Decrease</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">by %</SelectItem>
                    <SelectItem value="amount">by ৳</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field label={method === 'percent' ? 'Percent' : 'Amount per unit (৳)'}>
              <Input inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} placeholder={method === 'percent' ? '5' : '2.50'} />
            </Field>
            <Field label="Rounding">
              <Select value={roundTo} onValueChange={(v) => setRoundTo(v as typeof roundTo)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Keep poisha</SelectItem>
                  <SelectItem value="100">Round to whole taka</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reason (optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Supplier price increase" maxLength={200} />
            </Field>
          </div>
          {method === 'percent' && <p className="text-xs text-muted-foreground">Units priced at ৳0 are left unchanged by a percentage change.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !amount}>
              {busy ? 'Updating…' : 'Update prices'}
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
