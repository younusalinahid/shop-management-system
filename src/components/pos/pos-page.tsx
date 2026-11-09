'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageOff, Minus, PauseCircle, Plus, Printer, ReceiptText, ScanBarcode, ShoppingCart, Trash2, UserPlus, Wallet, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { qtyText } from '@/components/inventory/qty'
import { useCatalog, useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { newId } from '@/lib/id'
import { formatMoney, moneyToInput } from '@/lib/money'
import type { Customer, HeldSale, SaleDetail } from '@/lib/sales'
import { unitPriceFor } from '@/lib/sales'
import { cn } from '@/lib/utils'
import type { ID, PaymentMethod, PriceMode, Product, ProductUnit } from '@/types/db'
import { addToCart, type Cart, cartView, emptyCart, type Lookup, repriceCart } from './cart'
import { CustomerDialog } from './customer-dialog'
import { PaymentDialog } from './payment-dialog'
import { PrintableReceipt, printNow, Receipt } from './receipt'

/**
 * Point of sale. Scan or search to add products, adjust units and quantities, take payment (split
 * across methods), print the receipt. F2 jumps to the search box, F9 opens payment.
 */
export function PosPage() {
  const t = useTranslations('pos')
  const settings = useSettings()
  const catalog = useCatalog()
  const refresh = useRefreshData()
  const canEditPrice = usePermission('products.edit_price')
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ items: Customer[] }>('/api/customers') })

  const [cart, setCart] = useState<Cart>(() => emptyCart(settings.defaultPriceMode))
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [payError, setPayError] = useState<string>()
  const [done, setDone] = useState<SaleDetail | null>(null)
  const [newCustomer, setNewCustomer] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // One key per checkout: a double click or a retried request never records the sale twice.
  const saleKey = useRef(newId())

  const lookup: Lookup = useMemo(
    () => ({
      product: (id) => catalog?.products.find((p) => p.id === id),
      units: (id) => catalog?.unitsByProduct.get(id) ?? [],
    }),
    [catalog],
  )
  const view = useMemo(() => cartView(cart, lookup, settings.pricesIncludeTax), [cart, lookup, settings.pricesIncludeTax])
  const activeCustomers = (customers.data?.items ?? []).filter((c) => c.status === 'active')
  const customer = activeCustomers.find((c) => c.id === cart.customerId)

  const results = useMemo(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    const sellable = catalog.products.filter((p) => p.status === 'active' && (catalog.unitsByProduct.get(p.id) ?? []).some((u) => u.canSell))
    if (!q) return sellable.slice(0, 60)
    return sellable
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (catalog.barcodesByProduct.get(p.id) ?? []).some((b) => b.code.toLowerCase().startsWith(q)))
      .slice(0, 60)
  }, [catalog, query])

  const add = useCallback(
    (product: Product, unit?: ProductUnit) => {
      const units = (catalog?.unitsByProduct.get(product.id) ?? []).filter((u) => u.canSell)
      const u = unit && unit.canSell ? unit : units[0]
      if (!u) return
      setCart((c) => addToCart(c, product, u))
    },
    [catalog],
  )

  /** Enter in the search box: exact barcode (with its package unit), exact SKU, or the only match. */
  const submitSearch = () => {
    if (!catalog) return
    const code = query.trim()
    if (!code) return
    for (const [productId, codes] of catalog.barcodesByProduct) {
      const hit = codes.find((b) => b.code === code)
      if (hit) {
        const product = lookup.product(productId)
        if (product && product.status === 'active') {
          add(product, lookup.units(productId).find((u) => u.id === hit.unitId))
          setQuery('')
          return
        }
      }
    }
    const bySku = catalog.products.find((p) => p.status === 'active' && p.sku.toLowerCase() === code.toLowerCase())
    const pick = bySku ?? (results.length === 1 ? results[0] : undefined)
    if (pick) {
      add(pick)
      setQuery('')
    } else {
      toast.error(t('notFound', { code }))
    }
  }

  const openPayment = useCallback(() => {
    if (!view.ready) {
      toast.error(cart.lines.length === 0 ? t('emptyCart') : t('fixLines'))
      return
    }
    setPayError(undefined)
    setPaying(true)
  }, [view.ready, cart.lines.length, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'F9') {
        e.preventDefault()
        openPayment()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPayment])

  const setMode = (mode: PriceMode) => setCart((c) => repriceCart(c, mode, lookup))
  const setCustomer = (id: string) => {
    const c = activeCustomers.find((x) => x.id === id)
    setCart((cur) => {
      const next = { ...cur, customerId: id === 'walk-in' ? undefined : id }
      return c?.priceMode && c.priceMode !== cur.priceMode ? repriceCart(next, c.priceMode, lookup) : next
    })
  }
  const updateLine = (key: string, patch: Partial<Cart['lines'][number]>) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const step = (key: string, delta: number) =>
    setCart((c) => ({
      ...c,
      lines: c.lines.map((l) => {
        if (l.key !== key) return l
        const n = Number(l.quantity)
        const next = Math.round(((Number.isFinite(n) ? n : 0) + delta) * 1000) / 1000
        return next > 0 ? { ...l, quantity: String(next) } : l
      }),
    }))
  const clear = () => {
    setCart(emptyCart(settings.defaultPriceMode))
    saleKey.current = newId()
  }

  const pay = async (payments: Array<{ method: PaymentMethod; amount: number; reference: string }>) => {
    setBusy(true)
    setPayError(undefined)
    try {
      const sale = await api.post<SaleDetail>('/api/sales', {
        idempotencyKey: saleKey.current,
        customerId: cart.customerId,
        priceMode: cart.priceMode,
        items: view.lines.map((v) => ({ productId: v.line.productId, unitId: v.line.unitId, quantity: v.line.quantity.trim(), unitPrice: v.unitPrice ?? 0, discount: v.discount ?? 0 })),
        invoiceDiscount: view.calc.invoiceDiscount,
        payments,
        note: cart.note,
      })
      setPaying(false)
      setDone(sale)
      clear()
      await refresh()
    } catch (e) {
      setPayError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const hold = async () => {
    if (cart.lines.length === 0) return
    try {
      const label = customer?.name || t('heldLabel', { time: formatDateTime(Date.now()).slice(-8) })
      await api.post('/api/held-sales', { label, cart })
      clear()
      await refresh()
      toast.success(t('heldToast', { label }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (!catalog) return <LoadingState />

  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-7.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      {/* Products */}
      <Card className="flex min-h-0 flex-col gap-0 py-0">
        <div className="flex items-center gap-2 border-b p-3">
          <div className="relative flex-1">
            <ScanBarcode className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-primary" aria-hidden />
            <Input
              ref={searchRef}
              autoFocus
              className="h-11 pl-11 text-base"
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchLabel')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitSearch()
                }
                if (e.key === 'Escape') setQuery('')
              }}
            />
          </div>
          <Button variant="outline" onClick={() => setHeldOpen(true)}>
            <PauseCircle /> <span className="hidden sm:inline">{t('held')}</span>
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
          {results.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{t('noProducts')}</p>}
          {results.map((p) => {
            const units = catalog.unitsByProduct.get(p.id) ?? []
            const sell = units.find((u) => u.canSell)
            const out = p.stockQty <= 0
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p)}
                className={cn(
                  'group flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md active:scale-[0.98]',
                  out && 'opacity-60',
                )}
              >
                {p.imageDataUrl ? (
                  <img src={p.imageDataUrl} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <ImageOff className="size-5" aria-hidden />
                  </div>
                )}
                <span className="line-clamp-2 text-sm leading-tight font-semibold group-hover:text-primary">{p.name}</span>
                <span className="flex items-center justify-between gap-1 text-xs">
                  <span className="font-bold text-primary">{sell ? `${formatMoney(unitPriceFor(sell, cart.priceMode))}/${sell.name}` : '—'}</span>
                </span>
                <span className={cn('text-xs', out ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{out ? t('outOfStock') : qtyText(p.stockQty, units, p.baseUnitName)}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* Cart */}
      <Card className="flex min-h-0 flex-col gap-0 py-0">
        <div className="grid gap-2 border-b p-3">
          <div className="flex gap-2">
            <Select value={cart.customerId ?? 'walk-in'} onValueChange={setCustomer}>
              <SelectTrigger className="w-full min-w-0" aria-label={t('customer')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in">{t('walkIn')}</SelectItem>
                {activeCustomers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.phone && ` · ${c.phone}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setNewCustomer(true)} aria-label={t('newCustomer')}>
              <UserPlus />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Tabs value={cart.priceMode} onValueChange={(v) => setMode(v as PriceMode)}>
              <TabsList>
                <TabsTrigger value="retail">{t('retail')}</TabsTrigger>
                <TabsTrigger value="wholesale">{t('wholesale')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {customer && customer.balance > 0 && <Badge variant="warning">{t('customerDue', { amount: formatMoney(customer.balance) })}</Badge>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.lines.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <ShoppingCart className="size-10 text-primary/40" aria-hidden />
              <p className="font-semibold text-foreground">{t('emptyTitle')}</p>
              <p className="text-sm">{t('emptyText')}</p>
            </div>
          ) : (
            <ul className="divide-y">
              {view.lines.map((v) => (
                <li key={v.line.key} className="grid gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-tight font-semibold">{v.product?.name}</p>
                    <button type="button" className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={() => setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== v.line.key) }))} aria-label={t('remove', { name: v.product?.name ?? '' })}>
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    <div className="flex items-center rounded-md border">
                      <Button variant="ghost" size="icon-sm" onClick={() => step(v.line.key, -1)} aria-label={t('less')}>
                        <Minus />
                      </Button>
                      <Input
                        className="h-8 w-14 border-0 px-1 text-center font-semibold shadow-none focus-visible:ring-0"
                        inputMode="decimal"
                        value={v.line.quantity}
                        onChange={(e) => updateLine(v.line.key, { quantity: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        aria-label={t('qtyOf', { name: v.product?.name ?? '' })}
                        aria-invalid={!!v.qtyError}
                      />
                      <Button variant="ghost" size="icon-sm" onClick={() => step(v.line.key, 1)} aria-label={t('more')}>
                        <Plus />
                      </Button>
                    </div>
                    <Select
                      value={v.line.unitId}
                      onValueChange={(unitId) => {
                        const u = v.sellUnits.find((x) => x.id === unitId)
                        updateLine(v.line.key, { unitId, price: u ? moneyToInput(unitPriceFor(u, cart.priceMode)) : v.line.price })
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full" aria-label={t('unitOf', { name: v.product?.name ?? '' })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {v.sellUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="min-w-20 text-right font-bold">{formatMoney(v.lineTotal)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {canEditPrice ? (
                      <label className="flex items-center gap-1">
                        {t('price')}
                        <Input className="h-7 w-20 px-1.5 text-right text-xs" inputMode="decimal" value={v.line.price} onChange={(e) => updateLine(v.line.key, { price: e.target.value })} aria-invalid={v.unitPrice === null} />
                      </label>
                    ) : (
                      <span>
                        {formatMoney(v.unitPrice ?? 0)} / {v.unit?.name}
                      </span>
                    )}
                    <label className="flex items-center gap-1">
                      {t('discount')}
                      <Input className="h-7 w-16 px-1.5 text-right text-xs" inputMode="decimal" value={v.line.discount} placeholder="0" onChange={(e) => updateLine(v.line.key, { discount: e.target.value })} aria-invalid={v.discount === null} />
                    </label>
                  </div>
                  {v.qtyError && <p className="text-xs font-medium text-destructive">{v.qtyError === 'fraction' ? t('wholeOnly', { unit: v.unit?.name ?? '' }) : t('badQty')}</p>}
                  {!v.qtyError && v.short && v.product && (
                    <p className="text-xs font-medium text-warning-foreground dark:text-warning">{t('short', { qty: qtyText(v.product.stockQty, lookup.units(v.product.id), v.product.baseUnitName) })}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-2 border-t bg-muted/30 p-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('subtotal')}</span>
            <span className="font-semibold">{formatMoney(view.calc.subtotal)}</span>
          </div>
          {view.calc.itemDiscountTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('itemDiscounts')}</span>
              <span>−{formatMoney(view.calc.itemDiscountTotal)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <label htmlFor="pos-inv-disc" className="text-muted-foreground">
              {t('invoiceDiscount')}
            </label>
            <Input id="pos-inv-disc" className="h-8 w-28 text-right" inputMode="decimal" placeholder="0" value={cart.invoiceDiscount} onChange={(e) => setCart((c) => ({ ...c, invoiceDiscount: e.target.value }))} aria-invalid={!view.invoiceDiscountValid} />
          </div>
          {view.calc.taxTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{settings.pricesIncludeTax ? t('vatIncluded') : t('vat')}</span>
              <span>{formatMoney(view.calc.taxTotal)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-lg font-bold">{t('total')}</span>
            <span className="text-3xl font-bold text-primary">{formatMoney(view.calc.total)}</span>
          </div>
          <div className="grid grid-cols-[auto_auto_1fr] gap-2">
            <Button variant="outline" onClick={() => void hold()} disabled={cart.lines.length === 0} title={t('hold')}>
              <PauseCircle /> <span className="hidden sm:inline">{t('hold')}</span>
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={clear} disabled={cart.lines.length === 0} aria-label={t('clear')}>
              <Trash2 />
            </Button>
            <Button variant="success" size="lg" onClick={openPayment} disabled={cart.lines.length === 0}>
              <Wallet /> {t('pay')} <kbd className="ml-1 hidden rounded bg-white/20 px-1 text-xs sm:inline">F9</kbd>
            </Button>
          </div>
        </div>
      </Card>

      {paying && <PaymentDialog total={view.calc.total} hasCustomer={!!cart.customerId} busy={busy} error={payError} onPay={(p) => void pay(p)} onClose={() => setPaying(false)} />}
      {newCustomer && (
        <CustomerDialog
          onClose={() => setNewCustomer(false)}
          onCreated={(c) => {
            setNewCustomer(false)
            void customers.refetch().then(() => setCustomer(c.id))
            setCart((cur) => ({ ...cur, customerId: c.id }))
          }}
        />
      )}
      {heldOpen && (
        <HeldDialog
          onClose={() => setHeldOpen(false)}
          onResume={(h) => {
            const held = h.cart as Cart
            if (cart.lines.length > 0) {
              toast.error(t('finishFirst'))
              return false
            }
            setCart({ ...emptyCart(settings.defaultPriceMode), ...held })
            saleKey.current = newId()
            setHeldOpen(false)
            return true
          }}
        />
      )}
      {done && (
        <Dialog open onOpenChange={(o) => !o && setDone(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-success">
                <ReceiptText className="size-5" /> {t('doneTitle', { no: done.invoiceNo })}
              </DialogTitle>
              <DialogDescription>{done.changeGiven > 0 ? t('giveChange', { amount: formatMoney(done.changeGiven) }) : t('doneText')}</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-white">
              <Receipt sale={done} settings={settings} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => printNow()}>
                <Printer /> {t('print')}
              </Button>
              <Button
                onClick={() => {
                  setDone(null)
                  searchRef.current?.focus()
                }}
                autoFocus
              >
                {t('newSale')}
              </Button>
            </DialogFooter>
            <PrintableReceipt sale={done} settings={settings} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function HeldDialog({ onClose, onResume }: { onClose: () => void; onResume: (h: HeldSale) => boolean }) {
  const t = useTranslations('pos')
  const refresh = useRefreshData()
  const held = useQuery({ queryKey: ['held-sales'], queryFn: () => api.get<{ items: HeldSale[] }>('/api/held-sales') })
  const remove = async (id: ID) => {
    await api.delete(`/api/held-sales/${id}`)
    await refresh()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('heldTitle')}</DialogTitle>
          <DialogDescription>{t('heldText')}</DialogDescription>
        </DialogHeader>
        {held.isPending ? (
          <LoadingState />
        ) : (held.data?.items ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('noHeld')}</p>
        ) : (
          <ul className="grid gap-2">
            {held.data!.items.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{h.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('heldMeta', { count: (h.cart as Cart)?.lines?.length ?? 0, user: h.userName, time: formatDateTime(h.createdAt) })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      // The held cart is removed only once it is back in the POS.
                      if (onResume(h)) void remove(h.id)
                    }}
                  >
                    {t('resume')}
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => void remove(h.id)} aria-label={t('discard', { label: h.label })}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
