'use client'

import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCatalog, useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { formatDateOnly, NO_EXPIRY } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { ADJUSTMENT_TYPES, DECREASE_TYPES, type AdjustmentType, isIncrease } from '@/lib/inventory'
import { moneyToInput, tryParseMoney } from '@/lib/money'
import { formatQty, toBaseQty, UnitError } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { ID, ProductBatch } from '@/types/db'
import { ProductPicker } from './product-picker'
import { qtyText } from './qty'

/**
 * One dialog for every manual stock change: opening stock, corrections (+/−) and write-offs
 * (damaged, lost, expired). The server records a stock movement and an audit entry with the reason.
 */
export function AdjustStockDialog({
  productId: fixedProduct,
  batch,
  defaultType = 'adjustment_increase',
  onClose,
}: {
  productId?: ID
  /** Write off from this batch only. */
  batch?: Pick<ProductBatch, 'id' | 'batchNo' | 'qtyRemaining' | 'expiryDate'>
  defaultType?: AdjustmentType
  onClose: () => void
}) {
  const t = useTranslations('adjust')
  const tm = useTranslations('movement')
  const tc = useTranslations('common')
  const catalog = useCatalog()
  const refresh = useRefreshData()
  const ids = useId()

  const [productId, setProductId] = useState<ID | undefined>(fixedProduct)
  const [type, setType] = useState<AdjustmentType>(defaultType)
  const [unitId, setUnitId] = useState<ID | undefined>()
  const [quantity, setQuantity] = useState('')
  const [cost, setCost] = useState<string | undefined>()
  const [batchNo, setBatchNo] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [batchId, setBatchId] = useState<ID | 'auto'>(batch?.id ?? 'auto')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const product = productId ? catalog?.products.find((p) => p.id === productId) : undefined
  const units = useMemo(() => (productId ? (catalog?.unitsByProduct.get(productId) ?? []) : []), [catalog, productId])
  const unit = units.find((u) => u.id === unitId) ?? units.find((u) => u.canSell) ?? units[0]
  const increase = isIncrease(type)

  const batches = useQuery({
    queryKey: ['batches', 'product', productId],
    queryFn: () => api.get<{ items: ProductBatch[] }>(`/api/inventory/batches?state=in_stock&productId=${productId}`),
    enabled: !!product?.trackBatches && !increase && !batch,
  })

  // Live preview: the quantity in base units and the stock afterwards.
  let baseQty: number | undefined
  let qtyError: string | undefined
  if (product && unit && quantity.trim()) {
    try {
      baseQty = toBaseQty(quantity, unit, product.allowFraction)
    } catch (e) {
      qtyError = e instanceof UnitError ? t('badQuantity') : String(e)
    }
  }
  const after = product && baseQty !== undefined ? product.stockQty + (increase ? baseQty : -baseQty) : undefined
  const costValue = cost ?? (unit ? moneyToInput(unit.purchasePrice) : '')

  const submit = async () => {
    setError(undefined)
    if (!product || !unit) return setError(t('pickProduct'))
    if (baseQty === undefined) return setError(qtyError ?? t('enterQuantity'))
    if (type !== 'opening' && !reason.trim()) return setError(t('reasonRequired'))
    const unitCost = increase ? tryParseMoney(costValue || '0') : undefined
    if (increase && unitCost === null) return setError(t('badCost'))
    setBusy(true)
    try {
      await api.post('/api/inventory/adjust', {
        productId: product.id,
        type,
        unitId: unit.id,
        quantity: quantity.trim(),
        ...(increase && { unitCost: unitCost ?? 0, batchNo, expiryDate: expiryDate || undefined }),
        ...(!increase && batchId !== 'auto' && { batchId }),
        reason: reason.trim(),
      })
      await refresh()
      toast.success(t('savedToast', { name: product.name }))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {!catalog ? null : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {!fixedProduct && (
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-product`}>{t('product')}</Label>
                <ProductPicker
                  id={`${ids}-product`}
                  catalog={catalog}
                  value={productId}
                  onChange={(id) => {
                    setProductId(id)
                    setUnitId(undefined)
                    setCost(undefined)
                  }}
                />
              </div>
            )}
            {product && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-semibold">{product.name}</span> · {t('current', { qty: qtyText(product.stockQty, units, product.baseUnitName) })}
                {batch && <> · {t('batchLabel', { batch: batch.batchNo })}</>}
              </p>
            )}

            {(
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-type`}>{t('type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
                  <SelectTrigger id={`${ids}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(batch ? DECREASE_TYPES : ADJUSTMENT_TYPES).map((k) => (
                      <SelectItem key={k} value={k}>
                        {isIncrease(k) ? '＋ ' : '－ '}
                        {tm(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t(`hint.${type}`)}</p>
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-qty`}>{t('quantity')}</Label>
                <Input id={`${ids}-qty`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" aria-invalid={!!qtyError} autoFocus={!!fixedProduct} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-unit`}>{t('unit')}</Label>
                <Select value={unit?.id ?? ''} onValueChange={(v) => { setUnitId(v); setCost(undefined) }} disabled={!product}>
                  <SelectTrigger id={`${ids}-unit`} className="w-36">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {qtyError ? (
              <p className="-mt-2 text-sm text-destructive">{qtyError}</p>
            ) : (
              after !== undefined &&
              product &&
              unit && (
                <p className={cn('-mt-2 text-sm', after < 0 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                  {unit.factor > 1 && baseQty !== undefined && <>= {formatQty(baseQty, { name: product.baseUnitName, factor: 1 })} · </>}
                  {t('after', { qty: qtyText(after, units, product.baseUnitName) })}
                </p>
              )
            )}

            {increase && (
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-cost`}>{t('cost', { unit: unit?.name ?? '' })}</Label>
                <Input id={`${ids}-cost`} inputMode="decimal" value={costValue} onChange={(e) => setCost(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('costHint')}</p>
              </div>
            )}

            {increase && product?.trackBatches && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${ids}-batch`}>{t('batchNo')}</Label>
                  <Input id={`${ids}-batch`} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder={t('auto')} />
                </div>
                {product.trackExpiry && (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${ids}-exp`}>{t('expiry')}</Label>
                    <Input id={`${ids}-exp`} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
                  </div>
                )}
              </div>
            )}

            {!increase && product?.trackBatches && !batch && (
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-from`}>{t('fromBatch')}</Label>
                <Select value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger id={`${ids}-from`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('fefo')}</SelectItem>
                    {(batches.data?.items ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.batchNo} · {qtyText(b.qtyRemaining, units, product.baseUnitName)}
                        {b.expiryDate !== NO_EXPIRY && ` · ${formatDateOnly(b.expiryDate)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-reason`}>
                {t('reason')} {type === 'opening' && <span className="font-normal text-muted-foreground">({t('optional')})</span>}
              </Label>
              <Textarea id={`${ids}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} />
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={busy || !product} variant={increase ? 'default' : 'destructive'}>
                {busy ? tc('working') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
