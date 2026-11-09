'use client'

import { useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, PackagePlus, Plus, Save, Trash2, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ProductPicker } from '@/components/inventory/product-picker'
import { qtyText } from '@/components/inventory/qty'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { purchaseUrl } from '@/constants/navigation'
import { useCatalog, useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { todayDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { newId } from '@/lib/id'
import { type PurchaseDetail, purchaseTotals, type Supplier } from '@/lib/inventory'
import { formatMoney, moneyToInput, multiplyMoney, tryParseMoney } from '@/lib/money'
import { toBaseQty, UnitError } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { ID, Product, ProductUnit } from '@/types/db'
import { SupplierDialog } from './supplier-dialog'

interface Line {
  key: string
  productId: ID
  unitId: ID
  quantity: string
  cost: string
  batchNo: string
  expiryDate: string
}

interface LineView {
  line: Line
  product?: Product
  units: ProductUnit[]
  unit?: ProductUnit
  baseQty?: number
  amount?: number
  qtyError?: string
  costError?: string
  expiryMissing: boolean
}

/** New purchase: supplier, products in their purchase units, costs, discount, transport, paid and due. */
export function PurchaseFormPage() {
  const t = useTranslations('purchaseForm')
  const tc = useTranslations('common')
  const router = useRouter()
  const ids = useId()
  const catalog = useCatalog()
  const refresh = useRefreshData()
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ items: Supplier[] }>('/api/suppliers') })

  const [supplierId, setSupplierId] = useState<string>('none')
  const [date, setDate] = useState(todayDateOnly())
  const [referenceNo, setReferenceNo] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState('')
  const [extra, setExtra] = useState('')
  const [paid, setPaid] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [newSupplier, setNewSupplier] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  // One key per form: a double click or a retried request can't save the purchase twice.
  const idempotencyKey = useRef(newId())

  const views: LineView[] = useMemo(
    () =>
      lines.map((line) => {
        const product = catalog?.products.find((p) => p.id === line.productId)
        const units = (catalog?.unitsByProduct.get(line.productId) ?? []).filter((u) => u.canPurchase)
        const unit = units.find((u) => u.id === line.unitId)
        let baseQty: number | undefined
        let qtyError: string | undefined
        if (product && unit) {
          try {
            baseQty = toBaseQty(line.quantity, unit, product.allowFraction)
          } catch (e) {
            qtyError = e instanceof UnitError ? (line.quantity.trim() ? t('badQuantity') : t('enterQuantity')) : String(e)
          }
        }
        const cost = tryParseMoney(line.cost || '0')
        const costError = cost === null || cost < 0 ? t('badAmount') : undefined
        const amount = baseQty !== undefined && cost !== null ? multiplyMoney(cost, line.quantity) : undefined
        return { line, product, units, unit, baseQty, amount, qtyError, costError, expiryMissing: !!product?.trackBatches && !!product.trackExpiry && !line.expiryDate }
      }),
    [lines, catalog, t],
  )

  const discountValue = tryParseMoney(discount || '0')
  const extraValue = tryParseMoney(extra || '0')
  const valid = views.filter((v) => v.amount !== undefined)
  const totals = purchaseTotals(
    valid.map((v) => ({ quantity: v.line.quantity, unitCost: tryParseMoney(v.line.cost || '0') ?? 0 })),
    discountValue ?? 0,
    extraValue ?? 0,
    0,
  )
  // "Paid" follows the total until the user types an amount (most purchases are paid in full).
  const paidValue = paid === null ? totals.total : tryParseMoney(paid || '0')
  const due = paidValue === null ? totals.total : Math.max(0, totals.total - paidValue)

  const addProduct = (productId: ID | undefined) => {
    if (!productId || !catalog) return
    const product = catalog.products.find((p) => p.id === productId)!
    if (!product.trackBatches && lines.some((l) => l.productId === productId)) {
      toast.info(t('alreadyAdded', { name: product.name }))
      return
    }
    const units = (catalog.unitsByProduct.get(productId) ?? []).filter((u) => u.canPurchase)
    // Buy in the biggest unit by default (Sack for rice, Carton for biscuits).
    const unit = [...units].sort((a, b) => b.factor - a.factor)[0]
    setLines((ls) => [...ls, { key: newId(), productId, unitId: unit?.id ?? '', quantity: '1', cost: unit ? moneyToInput(unit.purchasePrice) : '', batchNo: '', expiryDate: '' }])
  }
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const submit = async () => {
    setShowErrors(true)
    setError(undefined)
    if (lines.length === 0) return setError(t('addOne'))
    if (views.some((v) => v.qtyError || v.costError || v.expiryMissing || !v.unit)) return setError(t('fixLines'))
    if (discountValue === null || extraValue === null || paidValue === null) return setError(t('badAmount'))
    if (paidValue > totals.total) return setError(t('overpaid'))
    if (due > 0 && supplierId === 'none') return setError(t('dueNeedsSupplier'))
    setBusy(true)
    try {
      const saved = await api.post<PurchaseDetail>('/api/purchases', {
        idempotencyKey: idempotencyKey.current,
        supplierId: supplierId === 'none' ? undefined : supplierId,
        referenceNo,
        purchaseDate: date,
        items: views.map((v) => ({
          productId: v.line.productId,
          unitId: v.line.unitId,
          quantity: v.line.quantity.trim(),
          unitCost: tryParseMoney(v.line.cost || '0') ?? 0,
          batchNo: v.line.batchNo,
          expiryDate: v.line.expiryDate || undefined,
        })),
        discount: discountValue,
        additionalCost: extraValue,
        paid: paidValue,
        note,
      })
      await refresh()
      toast.success(t('savedToast', { no: saved.purchaseNo }))
      router.push(purchaseUrl(saved.id))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (!catalog) return <LoadingState />
  const activeSuppliers = (suppliers.data?.items ?? []).filter((s) => s.status === 'active')
  const supplier = activeSuppliers.find((s) => s.id === supplierId)

  return (
    <>
      <PageHeader
        icon={Truck}
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="outline" asChild>
            <Link href="/purchases">
              <ArrowLeft /> {t('back')}
            </Link>
          </Button>
        }
      />
      <form
        className="grid gap-6 xl:grid-cols-[1fr_22rem]"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('supplierTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-supplier`}>{t('supplier')}</Label>
                <div className="flex gap-2">
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id={`${ids}-supplier`} className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('noSupplier')}</SelectItem>
                      {activeSuppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.phone && ` · ${s.phone}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setNewSupplier(true)} aria-label={t('newSupplier')}>
                    <Plus /> <span className="hidden sm:inline">{t('new')}</span>
                  </Button>
                </div>
                {supplier && supplier.balance > 0 && <p className="text-xs text-muted-foreground">{t('supplierDue', { amount: formatMoney(supplier.balance) })}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-date`}>{t('date')}</Label>
                <Input id={`${ids}-date`} type="date" value={date} max={todayDateOnly()} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-ref`}>{t('reference')}</Label>
                <Input id={`${ids}-ref`} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder={t('referencePlaceholder')} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">{t('itemsTitle')}</CardTitle>
              <div className="w-full max-w-xs">
                <ProductPicker catalog={catalog} onChange={addProduct} placeholder={t('addProduct')} resetAfterPick filter={(p) => p.status === 'active' && (catalog.unitsByProduct.get(p.id) ?? []).some((u) => u.canPurchase)} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {views.length === 0 ? (
                <EmptyState icon={PackagePlus} title={t('noItemsTitle')} description={t('noItemsText')} />
              ) : (
                views.map((v, i) => (
                  <div key={v.line.key} className="grid gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {i + 1}. {v.product?.name}
                        </p>
                        {v.product && <p className="text-xs text-muted-foreground">{t('nowInStock', { qty: qtyText(v.product.stockQty, catalog.unitsByProduct.get(v.product.id) ?? [], v.product.baseUnitName) })}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => setLines((ls) => ls.filter((l) => l.key !== v.line.key))} aria-label={t('remove', { name: v.product?.name ?? '' })}>
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <div className="grid gap-1">
                        <Label htmlFor={`${v.line.key}-qty`} className="text-xs">{t('quantity')}</Label>
                        <Input id={`${v.line.key}-qty`} inputMode="decimal" value={v.line.quantity} onChange={(e) => update(v.line.key, { quantity: e.target.value })} aria-invalid={showErrors && !!v.qtyError} />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${v.line.key}-unit`} className="text-xs">{t('unit')}</Label>
                        <Select
                          value={v.line.unitId}
                          onValueChange={(unitId) => {
                            const u = v.units.find((x) => x.id === unitId)
                            update(v.line.key, { unitId, cost: u ? moneyToInput(u.purchasePrice) : v.line.cost })
                          }}
                        >
                          <SelectTrigger id={`${v.line.key}-unit`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {v.units.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${v.line.key}-cost`} className="text-xs">{t('costPer', { unit: v.unit?.name ?? '' })}</Label>
                        <Input id={`${v.line.key}-cost`} inputMode="decimal" value={v.line.cost} onChange={(e) => update(v.line.key, { cost: e.target.value })} placeholder="0" aria-invalid={!!v.costError} />
                      </div>
                      <div className="text-right sm:min-w-28">
                        <p className="text-xs text-muted-foreground">{t('amount')}</p>
                        <p className="text-lg font-bold">{v.amount !== undefined ? formatMoney(v.amount) : '—'}</p>
                      </div>
                    </div>
                    {v.product?.trackBatches && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1">
                          <Label htmlFor={`${v.line.key}-batch`} className="text-xs">{t('batchNo')}</Label>
                          <Input id={`${v.line.key}-batch`} value={v.line.batchNo} onChange={(e) => update(v.line.key, { batchNo: e.target.value })} placeholder={t('batchAuto')} />
                        </div>
                        {v.product.trackExpiry && (
                          <div className="grid gap-1">
                            <Label htmlFor={`${v.line.key}-exp`} className="text-xs">{t('expiry')}</Label>
                            <Input id={`${v.line.key}-exp`} type="date" value={v.line.expiryDate} onChange={(e) => update(v.line.key, { expiryDate: e.target.value })} aria-invalid={showErrors && v.expiryMissing} />
                          </div>
                        )}
                      </div>
                    )}
                    <p className={cn('text-sm', (v.qtyError || v.costError || v.expiryMissing) && showErrors ? 'text-destructive' : 'text-muted-foreground')}>
                      {showErrors && (v.qtyError || v.costError || (v.expiryMissing && t('expiryRequired')))}
                      {!(showErrors && (v.qtyError || v.costError || v.expiryMissing)) &&
                        v.product &&
                        v.baseQty !== undefined &&
                        t('willAdd', { qty: qtyText(v.baseQty, catalog.unitsByProduct.get(v.product.id) ?? [], v.product.baseUnitName) })}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Row label={t('subtotal')} value={formatMoney(totals.subtotal)} />
              <MoneyField id={`${ids}-disc`} label={t('discount')} value={discount} onChange={setDiscount} invalid={discountValue === null} />
              <MoneyField id={`${ids}-extra`} label={t('additionalCost')} hint={t('additionalHint')} value={extra} onChange={setExtra} invalid={extraValue === null} />
              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-semibold">{t('total')}</span>
                <span className="text-2xl font-bold">{formatMoney(totals.total)}</span>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${ids}-paid`}>{t('paid')}</Label>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPaid(null)}>
                      {t('paidFull')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPaid('0')}>
                      {t('paidNone')}
                    </Button>
                  </div>
                </div>
                <Input id={`${ids}-paid`} inputMode="decimal" value={paid ?? moneyToInput(totals.total)} onChange={(e) => setPaid(e.target.value)} aria-invalid={paidValue === null} />
              </div>
              <div className={cn('flex items-center justify-between rounded-md px-3 py-2', due > 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
                <span className="font-semibold">{t('due')}</span>
                <span className="text-lg font-bold">{formatMoney(due)}</span>
              </div>
              {due > 0 && supplierId === 'none' && <p className="text-xs text-destructive">{t('dueNeedsSupplier')}</p>}
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-note`}>{t('note')}</Label>
                <Textarea id={`${ids}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" variant="success" disabled={busy}>
                <Save /> {busy ? tc('working') : t('save')}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t('saveHint')}</p>
            </CardContent>
          </Card>
        </div>
      </form>
      {newSupplier && (
        <SupplierDialog
          onClose={() => setNewSupplier(false)}
          onCreated={(s) => {
            setNewSupplier(false)
            setSupplierId(s.id)
          }}
        />
      )}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function MoneyField({ id, label, hint, value, onChange, invalid }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_8rem] items-center gap-2">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </Label>
      <Input id={id} inputMode="decimal" className="text-right" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" aria-invalid={invalid} />
    </div>
  )
}
