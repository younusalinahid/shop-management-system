'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Barcode as BarcodeIcon, Minus, Plus, Printer, ScanLine, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { BarcodeSvg } from '@/components/shared/barcode-svg'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { PageHeader } from '@/components/shared/page-header'
import { PrintPortal, printNow } from '@/components/shared/print-portal'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ID, Product, ProductBarcode, ProductUnit } from '@/types/db'
import { type CatalogSnapshot, useCatalog } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { formatMoney } from '@/lib/money'
import { errorMessage } from '@/lib/errors'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { ApiError } from '@/lib/errors'

interface LabelItem {
  barcodeId: ID
  copies: number
}

const LABEL_PRESETS = {
  'roll-38x25': { label: '38 × 25 mm roll', w: 38, h: 25, sheet: false },
  'roll-50x30': { label: '50 × 30 mm roll', w: 50, h: 30, sheet: false },
  'a4-3x8': { label: 'A4 sheet, 3 × 8 (64 × 34 mm)', w: 64, h: 34, sheet: true },
} as const
type PresetKey = keyof typeof LABEL_PRESETS

export function BarcodesPage({ productId }: { productId?: string }) {
  const catalog = useCatalog()
  const settings = useSettings()
  const canEdit = usePermission('products.edit')
  const refresh = useRefreshData()
  const [items, setItems] = useState<LabelItem[]>([])
  const [preset, setPreset] = useState<PresetKey>('roll-38x25')
  const [showPrice, setShowPrice] = useState(true)
  const [showShop, setShowShop] = useState(false)

  const index = useMemo(() => (catalog ? buildIndex(catalog) : null), [catalog])

  // Pre-fill from /barcodes?product=<id> (the "Print labels" button on a product).
  const prefilled = useRef(false)
  useEffect(() => {
    if (!catalog || prefilled.current || !productId) return
    prefilled.current = true
    setItems((catalog.barcodesByProduct.get(productId) ?? []).map((b) => ({ barcodeId: b.id, copies: 1 })))
  }, [catalog, productId])

  if (!catalog || !index) return <LoadingState />

  const missing = catalog.products.filter((p) => p.status === 'active' && !(catalog.barcodesByProduct.get(p.id)?.length))
  const labels = items.flatMap((it) => {
    const row = index.get(it.barcodeId)
    return row ? Array.from({ length: it.copies }, () => row) : []
  })
  const size = LABEL_PRESETS[preset]

  const generateMissing = async () => {
    try {
      const { added: n } = await api.post<{ added: number }>('/api/barcodes/assign', { productIds: missing.map((p) => p.id) })
      await refresh()
      toast.success(`${n} barcode(s) generated`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const add = (barcodeId: ID) =>
    setItems((list) => (list.some((i) => i.barcodeId === barcodeId) ? list.map((i) => (i.barcodeId === barcodeId ? { ...i, copies: i.copies + 1 } : i)) : [...list, { barcodeId, copies: 1 }]))

  return (
    <>
      <PageHeader title="Barcode Management" description="Test your scanner, generate in-store barcodes and print labels." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <ScanTester />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Products without a barcode</CardTitle>
              <CardDescription>
                {missing.length === 0 ? 'Every active product has at least one barcode.' : `${missing.length} active product(s) have no barcode.`}
              </CardDescription>
            </CardHeader>
            {missing.length > 0 && canEdit && (
              <CardContent className="space-y-3">
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-muted-foreground">
                  {missing.slice(0, 50).map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                  {missing.length > 50 && <li>…and {missing.length - 50} more</li>}
                </ul>
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      <Wand2 /> Generate for all {missing.length}
                    </Button>
                  }
                  title="Generate in-store barcodes?"
                  description="Each listed product gets a unique EAN-13 code starting with 2 (reserved for in-store use, so it never clashes with manufacturer barcodes)."
                  confirmLabel="Generate"
                  onConfirm={generateMissing}
                />
              </CardContent>
            )}
          </Card>
        </div>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Print labels</CardTitle>
            <CardDescription>Add barcodes, set copies and print. Prices printed are the retail price of the barcode&apos;s unit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BarcodePicker index={index} onPick={add} />
            {items.length === 0 ? (
              <EmptyState icon={BarcodeIcon} title="No labels queued" description="Search for a product above to add its barcode." />
            ) : (
              <ul className="divide-y rounded-md border">
                {items.map((it) => {
                  const row = index.get(it.barcodeId)
                  if (!row) return null
                  return (
                    <li key={it.barcodeId} className="flex flex-wrap items-center gap-3 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.product.name} <span className="text-muted-foreground">· {row.unit.name}</span>
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{row.barcode.code}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Fewer copies"
                          onClick={() => setItems((l) => l.map((i) => (i.barcodeId === it.barcodeId ? { ...i, copies: Math.max(1, i.copies - 1) } : i)))}
                        >
                          <Minus />
                        </Button>
                        <Input
                          className="h-8 w-16 text-center"
                          inputMode="numeric"
                          aria-label="Copies"
                          value={it.copies}
                          onChange={(e) => {
                            const n = Math.min(500, Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                            setItems((l) => l.map((i) => (i.barcodeId === it.barcodeId ? { ...i, copies: n } : i)))
                          }}
                        />
                        <Button variant="outline" size="icon-sm" aria-label="More copies" onClick={() => add(it.barcodeId)}>
                          <Plus />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setItems((l) => l.filter((i) => i.barcodeId !== it.barcodeId))}>
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Label size</Label>
                <Select value={preset} onValueChange={(v) => setPreset(v as PresetKey)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LABEL_PRESETS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(v === true)} /> Show price
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={showShop} onCheckedChange={(v) => setShowShop(v === true)} /> Show shop name
              </label>
            </div>

            {labels.length > 0 && (
              <>
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">Preview ({labels.length} label{labels.length === 1 ? '' : 's'})</p>
                  <div className="flex flex-wrap gap-2 rounded-md bg-muted p-3">
                    {labels.slice(0, 12).map((row, i) => (
                      <div key={i} className="bg-white shadow-sm" style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
                        <LabelContent row={row} showPrice={showPrice} shopName={showShop ? settings.shopName : undefined} format={settings.barcodeFormat} />
                      </div>
                    ))}
                    {labels.length > 12 && <p className="self-center text-sm text-muted-foreground">+{labels.length - 12} more</p>}
                  </div>
                </div>
                <Button onClick={printNow}>
                  <Printer /> Print {labels.length} label{labels.length === 1 ? '' : 's'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {labels.length > 0 && (
        <PrintPortal pageCss={size.sheet ? 'size: A4; margin: 10mm 8mm' : `size: ${size.w}mm ${size.h}mm; margin: 0`}>
          <div style={size.sheet ? { display: 'grid', gridTemplateColumns: `repeat(3, ${size.w}mm)`, gridAutoRows: `${size.h}mm`, gap: '0 2mm' } : undefined}>
            {labels.map((row, i) => (
              <div
                key={i}
                style={{
                  width: `${size.w}mm`,
                  height: `${size.h}mm`,
                  overflow: 'hidden',
                  breakInside: 'avoid',
                  ...(size.sheet ? {} : { breakAfter: 'page' }),
                }}
              >
                <LabelContent row={row} showPrice={showPrice} shopName={showShop ? settings.shopName : undefined} format={settings.barcodeFormat} />
              </div>
            ))}
          </div>
        </PrintPortal>
      )}
    </>
  )
}

interface IndexRow {
  barcode: ProductBarcode
  product: Product
  unit: ProductUnit
}

/** barcodeId -> barcode with its product and effective unit (base unit when not bound). */
function buildIndex(c: CatalogSnapshot): Map<ID, IndexRow> {
  const productById = new Map(c.products.map((p) => [p.id, p]))
  const map = new Map<ID, IndexRow>()
  for (const [productId, codes] of c.barcodesByProduct) {
    const product = productById.get(productId)
    const units = c.unitsByProduct.get(productId) ?? []
    const base = units.find((u) => u.isBase)
    if (!product || !base) continue
    for (const b of codes) map.set(b.id, { barcode: b, product, unit: units.find((u) => u.id === b.unitId) ?? base })
  }
  return map
}

function LabelContent({ row, showPrice, shopName, format }: { row: IndexRow; showPrice: boolean; shopName?: string; format: 'CODE128' | 'EAN13' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1mm 1.5mm', color: '#000', fontFamily: 'system-ui, sans-serif', lineHeight: 1.1 }}>
      {shopName && <div style={{ fontSize: '6pt', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>{shopName}</div>}
      <div style={{ fontSize: '7pt', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.product.name}
        {!row.unit.isBase && ` (${row.unit.name})`}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <BarcodeSvg value={row.barcode.code} format={format} height={40} className="max-h-full" />
      </div>
      {showPrice && (
        <div style={{ fontSize: '8pt', fontWeight: 700, textAlign: 'right' }}>
          {formatMoney(row.unit.retailPrice)} / {row.unit.name}
        </div>
      )}
    </div>
  )
}

function BarcodePicker({ index, onPick }: { index: Map<ID, IndexRow>; onPick: (barcodeId: ID) => void }) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return [...index.values()]
      .filter((r) => r.product.status === 'active')
      .filter((r) => r.product.name.toLowerCase().includes(s) || r.product.sku.toLowerCase().includes(s) || r.barcode.code.toLowerCase().startsWith(s))
      .slice(0, 8)
  }, [q, index])

  return (
    <div className="relative">
      <Input
        placeholder="Add label: search product, SKU or scan barcode…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // Scanners end with Enter: add the exact match straight away.
          if (e.key === 'Enter') {
            e.preventDefault()
            const exact = [...index.values()].find((r) => r.barcode.code === q.trim())
            const pick = exact ?? (matches.length === 1 ? matches[0] : undefined)
            if (pick) {
              onPick(pick.barcode.id)
              setQ('')
            }
          }
        }}
        aria-label="Search barcode to add"
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {matches.map((r) => (
            <li key={r.barcode.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(r.barcode.id)
                  setQ('')
                }}
              >
                <span className="truncate">
                  {r.product.name} <span className="text-muted-foreground">· {r.unit.name}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{r.barcode.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** USB scanners type the code and press Enter; this shows what the POS would resolve it to. */
function ScanTester() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<{ code: string; text: string; ok: boolean } | null>(null)

  const lookup = async () => {
    const c = code.trim()
    if (!c) return
    let hit: { product: Product; unit?: ProductUnit } | null = null
    try {
      hit = await api.get(`/api/barcodes/lookup?code=${encodeURIComponent(c)}`)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        setResult({ code: c, ok: false, text: errorMessage(e) })
        return
      }
    }
    setResult(
      hit
        ? { code: c, ok: true, text: `${hit.product.name} — ${hit.unit?.name ?? hit.product.baseUnitName}${hit.product.status === 'archived' ? ' (archived)' : ''}` }
        : { code: c, ok: false, text: 'No product has this barcode.' },
    )
    setCode('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="size-4" aria-hidden /> Scanner test
        </CardTitle>
        <CardDescription>Click the box and scan. Most USB scanners type like a keyboard and press Enter.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          className="font-mono"
          placeholder="Scan a barcode…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void lookup()
            }
          }}
          aria-label="Scan a barcode"
        />
        {result && (
          <div className={`rounded-md border p-3 text-sm ${result.ok ? 'border-success/40 bg-success/10' : 'border-destructive/40 bg-destructive/5'}`}>
            <p className="font-mono text-xs text-muted-foreground">{result.code}</p>
            <p className="font-medium">{result.text}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
