'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Control, type UseFormRegister } from 'react-hook-form'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Barcode as BarcodeIcon, ImagePlus, Info, Plus, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { BarcodeSvg } from '@/components/shared/barcode-svg'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { productUrl } from '@/constants/navigation'
import { db } from '@/db/database'
import type { ID } from '@/types/db'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { integerToDecimalString, mulToInteger, parseDecimal } from '@/lib/decimal'
import { newId } from '@/lib/id'
import { resizeImageFile } from '@/lib/image'
import { formatMoney, moneyToInput, multiplyMoney, parseMoney } from '@/lib/money'
import { BASE_UNIT_PRESETS, fromBaseQty, isValidFactor, MAX_FACTOR, PACKAGE_UNIT_SUGGESTIONS, toBaseQty } from '@/lib/units'
import { categoryPath } from '@/services/catalog-service'
import { errorMessage } from '@/services/errors'
import {
  BARCODE_RE,
  createProduct,
  detailToInput,
  generateBarcode,
  getProductDetail,
  type ProductInput,
  productHasHistory,
  updateProduct,
} from '@/services/product-service'
import { currentActor } from '@/stores/session-store'

// ---------------------------------------------------------------- form model

/**
 * A unit row. Non-base units are defined relative to an earlier unit:
 * "1 Carton = 24 × Packet" — the factor in base units is computed (24 × 12 = 288 Piece).
 */
interface UnitRow {
  key: ID
  name: string
  symbol: string
  qty: string
  of: ID
  canPurchase: boolean
  canSell: boolean
  retail: string
  wholesale: string
  purchase: string
}

interface BarcodeRow {
  code: string
  unitId: string
}

interface Values {
  name: string
  sku: string
  categoryId: string
  brandId: string
  description: string
  imageDataUrl: string
  allowFraction: boolean
  minStockQty: string
  minStockUnit: ID
  taxRate: string
  trackBatches: boolean
  trackExpiry: boolean
  units: UnitRow[]
  barcodes: BarcodeRow[]
}

function emptyUnit(of: ID, name = '', qty = ''): UnitRow {
  return { key: newId(), name, symbol: '', qty, of, canPurchase: true, canSell: true, retail: '', wholesale: '', purchase: '' }
}

function blankValues(taxRate: number): Values {
  const base = { ...emptyUnit('', 'Piece', '1'), symbol: 'pc' }
  return {
    name: '',
    sku: '',
    categoryId: '',
    brandId: '',
    description: '',
    imageDataUrl: '',
    allowFraction: false,
    minStockQty: '',
    minStockUnit: base.key,
    taxRate: integerToDecimalString(taxRate, 2),
    trackBatches: false,
    trackExpiry: false,
    units: [base],
    barcodes: [],
  }
}

function inputToValues(input: ProductInput): Values {
  const base = input.units.find((u) => u.isBase)!
  const ordered = [base, ...input.units.filter((u) => !u.isBase)]
  return {
    name: input.name,
    sku: input.sku ?? '',
    categoryId: input.categoryId ?? '',
    brandId: input.brandId ?? '',
    description: input.description ?? '',
    imageDataUrl: input.imageDataUrl ?? '',
    allowFraction: input.allowFraction,
    minStockQty: input.minStockQty ? String(input.minStockQty) : '',
    minStockUnit: base.id,
    taxRate: integerToDecimalString(input.taxRate, 2),
    trackBatches: input.trackBatches,
    trackExpiry: input.trackExpiry,
    units: ordered.map((u) => ({
      key: u.id,
      name: u.name,
      symbol: u.symbol ?? '',
      qty: String(u.factor),
      of: u.isBase ? '' : base.id,
      canPurchase: u.canPurchase,
      canSell: u.canSell,
      retail: moneyToInput(u.retailPrice),
      wholesale: moneyToInput(u.wholesalePrice),
      purchase: moneyToInput(u.purchasePrice),
    })),
    barcodes: input.barcodes.map((b) => ({ code: b.code, unitId: b.unitId ?? '' })),
  }
}

type FieldErrors = Array<{ path: string; message: string }>

/** Base-unit factor of every row, in order. Rows may only refer to rows above them. */
function computeFactors(units: readonly UnitRow[]): { factors: Map<ID, number>; errors: FieldErrors } {
  const factors = new Map<ID, number>()
  const errors: FieldErrors = []
  units.forEach((u, i) => {
    if (i === 0) {
      factors.set(u.key, 1)
      return
    }
    const ref = factors.get(u.of)
    if (ref === undefined) {
      errors.push({ path: `units.${i}.qty`, message: 'Pick a unit listed above this one' })
      return
    }
    try {
      const d = parseDecimal(u.qty)
      if (d.units <= 0n) throw new Error()
      const f = mulToInteger(d, ref, 'exact')
      if (!isValidFactor(f)) throw new Error()
      factors.set(u.key, f)
    } catch {
      errors.push({ path: `units.${i}.qty`, message: `Must come to a whole number of ${units[0].name || 'base units'} (max ${MAX_FACTOR.toLocaleString('en-US')})` })
    }
  })
  return { factors, errors }
}

function toInput(v: Values): { input?: ProductInput; errors: FieldErrors } {
  const errors: FieldErrors = []
  if (!v.name.trim()) errors.push({ path: 'name', message: 'Product name is required' })
  const { factors, errors: factorErrors } = computeFactors(v.units)
  errors.push(...factorErrors)

  const money = (s: string, path: string) => {
    if (s.trim() === '') return 0
    try {
      const m = parseMoney(s)
      if (m < 0) throw new Error()
      return m
    } catch {
      errors.push({ path, message: 'Up to 2 decimals' })
      return 0
    }
  }
  const units = v.units.map((u, i) => {
    if (!u.name.trim()) errors.push({ path: `units.${i}.name`, message: 'Name required' })
    return {
      id: u.key,
      name: u.name.trim(),
      symbol: u.symbol.trim() || undefined,
      factor: factors.get(u.key) ?? 1,
      isBase: i === 0,
      canPurchase: u.canPurchase,
      canSell: u.canSell,
      retailPrice: money(u.retail, `units.${i}.retail`),
      wholesalePrice: money(u.wholesale, `units.${i}.wholesale`),
      purchasePrice: money(u.purchase, `units.${i}.purchase`),
    }
  })

  let taxRate = 0
  try {
    const d = parseDecimal(v.taxRate || '0')
    taxRate = mulToInteger(d, 100, 'exact')
    if (taxRate < 0 || taxRate > 10000) throw new Error()
  } catch {
    errors.push({ path: 'taxRate', message: 'Percentage from 0 to 100, up to 2 decimals' })
  }

  let minStockQty = 0
  if (v.minStockQty.trim() && v.minStockQty.trim() !== '0') {
    const unitFactor = factors.get(v.minStockUnit)
    const unitRow = v.units.find((u) => u.key === v.minStockUnit)
    try {
      minStockQty = toBaseQty(v.minStockQty, { name: unitRow?.name ?? '', factor: unitFactor ?? 1 }, true)
    } catch (e) {
      errors.push({ path: 'minStockQty', message: e instanceof Error ? e.message : 'Invalid quantity' })
    }
  }

  const barcodes = v.barcodes.map((b, i) => {
    const code = b.code.trim()
    if (!BARCODE_RE.test(code)) errors.push({ path: `barcodes.${i}.code`, message: '1–48 characters, no spaces' })
    return { code, unitId: b.unitId && b.unitId !== v.units[0].key ? b.unitId : undefined }
  })

  if (errors.length) return { errors }
  return {
    errors,
    input: {
      name: v.name,
      sku: v.sku,
      categoryId: v.categoryId || undefined,
      brandId: v.brandId || undefined,
      description: v.description,
      imageDataUrl: v.imageDataUrl || undefined,
      allowFraction: v.allowFraction,
      minStockQty,
      taxRate,
      trackBatches: v.trackBatches || v.trackExpiry,
      trackExpiry: v.trackExpiry,
      units,
      barcodes,
    },
  }
}

// ---------------------------------------------------------------- page

/** /products/edit?id=… */
export function ProductEditPage() {
  const id = useSearchParams().get('id')
  if (!id) return <ErrorState title="No product selected" message="Open a product from the product list to edit it." />
  return <ProductFormPage id={id} />
}

/** Add (no id) or edit a product. */
export function ProductFormPage({ id }: { id?: ID }) {
  const settings = useSettings()
  const loaded = useLiveQuery(async () => {
    if (!id) return { input: null, locked: false }
    const d = await getProductDetail(id)
    return { input: d ? detailToInput(d) : null, locked: d ? await productHasHistory(id) : false, missing: !d }
  }, [id])

  // updatedAt 0 = settings still loading; the form's initial tax rate comes from them.
  if ((id && !loaded) || settings.updatedAt === 0) return <LoadingState />
  if (id && loaded && 'missing' in loaded && loaded.missing) {
    return <ErrorState title="Product not found" message="It may have been deleted." />
  }
  return (
    <ProductForm
      key={id ?? 'new'}
      id={id}
      initial={loaded?.input ? inputToValues(loaded.input) : blankValues(settings.defaultTaxRate)}
      baseLocked={!!loaded?.locked}
    />
  )
}

function ProductForm({ id, initial, baseLocked }: { id?: ID; initial: Values; baseLocked: boolean }) {
  const router = useRouter()
  const canEditPrice = usePermission('products.edit_price')
  const canViewCost = usePermission('products.view_cost')
  const form = useForm<Values>({ defaultValues: initial })
  const { control, register, handleSubmit, setValue, setError, formState } = form
  const unitsArray = useFieldArray({ control, name: 'units', keyName: 'rowId' })
  const barcodesArray = useFieldArray({ control, name: 'barcodes', keyName: 'rowId' })
  const units = useWatch({ control, name: 'units' })
  const trackExpiry = useWatch({ control, name: 'trackExpiry' })
  const [rootError, setRootError] = useState<string | null>(null)

  const catalog = useLiveQuery(async () => {
    const [categories, brands] = await Promise.all([db.categories.toArray(), db.brands.toArray()])
    return { categories, brands, byId: new Map(categories.map((c) => [c.id, c])) }
  }, [])

  const { factors } = useMemo(() => computeFactors(units), [units])
  const baseName = units[0]?.name || 'base unit'
  const preset = BASE_UNIT_PRESETS.find((p) => p.name.toLowerCase() === units[0]?.name.trim().toLowerCase())

  const submit = async (v: Values) => {
    setRootError(null)
    const { input, errors } = toInput(v)
    if (!input) {
      for (const e of errors) setError(e.path as never, { message: e.message })
      toast.error('Please fix the highlighted fields.')
      return
    }
    try {
      const actor = currentActor()
      const saved = id ? await updateProduct(actor, id, input) : await createProduct(actor, input)
      toast.success(id ? 'Product saved' : `${saved.name} added`)
      router.push(productUrl(saved.id))
    } catch (e) {
      setRootError(errorMessage(e))
      toast.error(errorMessage(e))
    }
  }

  const addStandardUnit = (name: string, symbol: string, factor: number) => {
    unitsArray.append({ ...emptyUnit(units[0].key, name, String(factor)), symbol })
  }

  const onBaseNameChange = (name: string) => {
    const p = BASE_UNIT_PRESETS.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (p && !id) {
      setValue('units.0.symbol', p.symbol)
      setValue('allowFraction', p.allowFraction)
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <PageHeader
        title={id ? 'Edit product' : 'Add product'}
        description={id ? initial.name : 'Set up the base unit first, then the packages you buy and sell in.'}
        actions={
          <Button variant="outline" asChild>
            <Link href={id ? productUrl(id) : '/products'}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FieldBlock label="Product name" htmlFor="p-name" error={formState.errors.name?.message} className="sm:col-span-2">
                <Input id="p-name" autoFocus={!id} placeholder="e.g. Miniket Rice" {...register('name')} aria-invalid={!!formState.errors.name} />
              </FieldBlock>
              <FieldBlock label="SKU" htmlFor="p-sku" hint="Leave blank to generate one. Stored in capitals." error={formState.errors.sku?.message}>
                <Input id="p-sku" placeholder="Auto" {...register('sku')} />
              </FieldBlock>
              <FieldBlock label="Tax / VAT (%)" htmlFor="p-tax" error={formState.errors.taxRate?.message}>
                <Input id="p-tax" inputMode="decimal" {...register('taxRate')} aria-invalid={!!formState.errors.taxRate} />
              </FieldBlock>
              <FieldBlock label="Category" htmlFor="p-category">
                <Controller
                  control={control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select value={field.value || 'none'} onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}>
                      <SelectTrigger id="p-category" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No category</SelectItem>
                        {catalog?.categories
                          .filter((c) => c.status === 'active' || c.id === field.value)
                          .map((c) => ({ id: c.id, label: categoryPath(c.id, catalog.byId) }))
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FieldBlock>
              <FieldBlock label="Brand" htmlFor="p-brand">
                <Controller
                  control={control}
                  name="brandId"
                  render={({ field }) => (
                    <Select value={field.value || 'none'} onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}>
                      <SelectTrigger id="p-brand" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No brand</SelectItem>
                        {catalog?.brands
                          .filter((b) => b.status === 'active' || b.id === field.value)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FieldBlock>
              <FieldBlock label="Description (optional)" htmlFor="p-desc" className="sm:col-span-2">
                <Textarea id="p-desc" rows={2} {...register('description')} />
              </FieldBlock>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Units &amp; prices</CardTitle>
              <CardDescription>
                Stock is always counted in the <strong>base unit</strong>, the smallest unit you ever sell (piece, gram, ml). Every other unit says how many of
                an earlier unit it holds. Each unit has its own prices, so a packet does not have to cost 35 × the piece price.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {baseLocked && (
                <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  This product already has stock or history, so its base unit stays the same. Renaming it does not convert stock.
                </p>
              )}
              <datalist id="base-unit-presets">
                {BASE_UNIT_PRESETS.map((p) => (
                  <option key={p.name} value={p.name} />
                ))}
              </datalist>
              <datalist id="package-units">
                {[...PACKAGE_UNIT_SUGGESTIONS, ...BASE_UNIT_PRESETS.flatMap((p) => p.standard.map((s) => s.name))].map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              <div className="space-y-3">
                {unitsArray.fields.map((field, i) => (
                  <UnitRowEditor
                    key={field.rowId}
                    index={i}
                    register={register}
                    control={control}
                    units={units}
                    factor={factors.get(units[i]?.key)}
                    baseName={baseName}
                    errors={formState.errors.units?.[i]}
                    canEditPrice={canEditPrice}
                    canViewCost={canViewCost}
                    onBaseNameChange={onBaseNameChange}
                    onRemove={() => {
                      const key = units[i].key
                      unitsArray.remove(i)
                      // Detach anything pointing at the removed unit.
                      form.getValues('units').forEach((u, k) => u.of === key && setValue(`units.${k}.of`, units[0].key))
                      form.getValues('barcodes').forEach((b, k) => b.unitId === key && setValue(`barcodes.${k}.unitId`, ''))
                      if (form.getValues('minStockUnit') === key) setValue('minStockUnit', units[0].key)
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {preset?.standard
                  .filter((s) => !units.some((u) => u.name.trim().toLowerCase() === s.name.toLowerCase()))
                  .map((s) => (
                    <Button key={s.name} type="button" variant="outline" size="sm" onClick={() => addStandardUnit(s.name, s.symbol, s.factor)}>
                      <Plus /> {s.name} (= {s.factor.toLocaleString('en-IN')} {preset.name})
                    </Button>
                  ))}
                <Button type="button" variant="outline" size="sm" onClick={() => unitsArray.append(emptyUnit(units[units.length - 1].key))} disabled={units.length >= 20}>
                  <Plus /> Add package unit
                </Button>
              </div>
              {!canEditPrice && <p className="text-xs text-muted-foreground">Your role cannot change prices; price fields are read-only.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Barcodes</CardTitle>
              <CardDescription>
                Scan a manufacturer barcode into the field, or generate an in-store code. A barcode linked to a package unit (e.g. Carton) selects that unit
                when scanned at the POS.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {barcodesArray.fields.length === 0 && <p className="text-sm text-muted-foreground">No barcodes yet.</p>}
              {barcodesArray.fields.map((field, i) => (
                <BarcodeRowEditor
                  key={field.rowId}
                  index={i}
                  control={control}
                  register={register}
                  units={units}
                  error={formState.errors.barcodes?.[i]?.code?.message}
                  onRemove={() => barcodesArray.remove(i)}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => barcodesArray.append({ code: '', unitId: '' })} disabled={barcodesArray.fields.length >= 50}>
                  <BarcodeIcon /> Add barcode
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={barcodesArray.fields.length >= 50}
                  onClick={async () => {
                    try {
                      const code = await generateBarcode(form.getValues('barcodes').map((b) => b.code.trim()))
                      barcodesArray.append({ code, unitId: '' })
                    } catch (e) {
                      toast.error(errorMessage(e))
                    }
                  }}
                >
                  <Wand2 /> Generate barcode
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Image</CardTitle>
            </CardHeader>
            <CardContent>
              <ImageField control={control} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SwitchRow control={control} name="allowFraction" label="Sell fractional quantities" hint={`e.g. 1.5 KG. Quantities are still stored as whole ${baseName}.`} />
              <div className="space-y-2">
                <Label htmlFor="minStockQty">Low-stock alert at</Label>
                <div className="flex gap-2">
                  <Input id="minStockQty" inputMode="decimal" placeholder="0" {...register('minStockQty')} aria-invalid={!!formState.errors.minStockQty} />
                  <Controller
                    control={control}
                    name="minStockUnit"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-32" aria-label="Unit for low-stock alert">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((u) => (
                            <SelectItem key={u.key} value={u.key}>
                              {u.name || '(unnamed)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {formState.errors.minStockQty && <p className="text-sm text-destructive">{formState.errors.minStockQty.message}</p>}
                <p className="text-xs text-muted-foreground">Leave empty for no alert.</p>
              </div>
              <SwitchRow control={control} name="trackBatches" label="Track batches" hint="Record a batch number on each purchase." disabled={trackExpiry} />
              <SwitchRow control={control} name="trackExpiry" label="Track expiry dates" hint="Sells the earliest-expiring batch first and blocks expired stock." />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        {rootError && <p className="text-sm text-destructive sm:mr-auto">{rootError}</p>}
        <Button type="button" variant="outline" onClick={() => router.push(id ? productUrl(id) : '/products')}>
          Cancel
        </Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Saving…' : id ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- pieces

function FieldBlock({ label, htmlFor, hint, error, className, children }: { label: string; htmlFor?: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SwitchRow({ control, name, label, hint, disabled }: { control: Control<Values>; name: 'allowFraction' | 'trackBatches' | 'trackExpiry'; label: string; hint?: string; disabled?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-4 rounded-md border p-3">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{label}</span>
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          </span>
          <Switch checked={field.value || (name === 'trackBatches' && !!disabled)} disabled={disabled} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  )
}

interface UnitRowEditorProps {
  index: number
  register: UseFormRegister<Values>
  control: Control<Values>
  units: UnitRow[]
  factor: number | undefined
  baseName: string
  errors?: Partial<Record<keyof UnitRow, { message?: string }>>
  canEditPrice: boolean
  canViewCost: boolean
  onBaseNameChange: (name: string) => void
  onRemove: () => void
}

function UnitRowEditor({ index, register, control, units, factor, baseName, errors, canEditPrice, canViewCost, onBaseNameChange, onRemove }: UnitRowEditorProps) {
  const uid = useId()
  const isBase = index === 0
  const row = units[index]
  if (!row) return null
  const base = units[0]
  const basePrice = (() => {
    try {
      return base.retail ? parseMoney(base.retail) : 0
    } catch {
      return 0
    }
  })()
  const nameReg = register(`units.${index}.name`)

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{isBase ? 'Base unit' : `Unit ${index + 1}`}</p>
        {!isBase && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${row.name || 'unit'}`}>
            <Trash2 />
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs" htmlFor={`${uid}-name`}>
            Name
          </Label>
          <Input
            id={`${uid}-name`}
            list={isBase ? 'base-unit-presets' : 'package-units'}
            placeholder={isBase ? 'Piece, Gram, ML…' : 'Packet, KG, Sack…'}
            {...nameReg}
            onChange={(e) => {
              void nameReg.onChange(e)
              if (isBase) onBaseNameChange(e.target.value)
            }}
            aria-invalid={!!errors?.name}
          />
          {errors?.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${uid}-symbol`}>
            Symbol
          </Label>
          <Input id={`${uid}-symbol`} placeholder={isBase ? 'pc' : 'pkt'} {...register(`units.${index}.symbol`)} />
        </div>
        {isBase ? (
          <div className="flex items-end pb-2 text-xs text-muted-foreground sm:col-span-3">Stock is counted in {baseName}.</div>
        ) : (
          <div className="space-y-1 sm:col-span-3">
            <Label className="text-xs" htmlFor={`${uid}-qty`}>
              1 {row.name || 'unit'} contains
            </Label>
            <div className="flex gap-2">
              <Input id={`${uid}-qty`} inputMode="decimal" className="w-24" placeholder="35" {...register(`units.${index}.qty`)} aria-invalid={!!errors?.qty} />
              <Controller
                control={control}
                name={`units.${index}.of`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label="Contained unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {units.slice(0, index).map((u) => (
                        <SelectItem key={u.key} value={u.key}>
                          {u.name || '(unnamed)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            {errors?.qty ? (
              <p className="text-xs text-destructive">{errors.qty.message}</p>
            ) : (
              factor !== undefined &&
              row.of !== base.key && (
                <p className="text-xs text-muted-foreground">
                  = {factor.toLocaleString('en-IN')} {baseName}
                </p>
              )
            )}
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-6">
        <PriceInput label="Retail ৳" reg={register(`units.${index}.retail`)} error={errors?.retail?.message} disabled={!canEditPrice} />
        <PriceInput label="Wholesale ৳" reg={register(`units.${index}.wholesale`)} error={errors?.wholesale?.message} disabled={!canEditPrice} />
        {canViewCost && <PriceInput label="Purchase cost ৳" reg={register(`units.${index}.purchase`)} error={errors?.purchase?.message} disabled={!canEditPrice} />}
        <div className="flex flex-wrap items-end gap-4 pb-2 sm:col-span-2">
          <CheckboxField control={control} name={`units.${index}.canSell`} label="Sell" />
          <CheckboxField control={control} name={`units.${index}.canPurchase`} label="Buy" />
        </div>
      </div>
      {!isBase && factor !== undefined && basePrice > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          For comparison: {factor.toLocaleString('en-IN')} × {base.name || 'base'} retail = {formatMoney(multiplyMoney(basePrice, factor))}
          {factor > 1 && ` · 1 ${base.name || 'base'} = ${fromBaseQty(1, { name: row.name, factor })} ${row.name || 'unit'}`}
        </p>
      )}
    </div>
  )
}

function PriceInput({ label, reg, error, disabled }: { label: string; reg: ReturnType<UseFormRegister<Values>>; error?: string; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="space-y-1 sm:col-span-1">
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Input id={id} inputMode="decimal" placeholder="0.00" disabled={disabled} {...reg} aria-invalid={!!error} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function CheckboxField({ control, name, label }: { control: Control<Values>; name: `units.${number}.canSell` | `units.${number}.canPurchase`; label: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
          {label}
        </label>
      )}
    />
  )
}

function BarcodeRowEditor({
  index,
  control,
  register,
  units,
  error,
  onRemove,
}: {
  index: number
  control: Control<Values>
  register: UseFormRegister<Values>
  units: UnitRow[]
  error?: string
  onRemove: () => void
}) {
  const code = useWatch({ control, name: `barcodes.${index}.code` })
  const settings = useSettings()
  return (
    <div className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_10rem_9rem_auto]">
      <div className="space-y-1">
        <Input placeholder="Scan or type barcode" className="font-mono" {...register(`barcodes.${index}.code`)} aria-invalid={!!error} aria-label="Barcode" />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Controller
        control={control}
        name={`barcodes.${index}.unitId`}
        render={({ field }) => (
          <Select value={field.value || 'base'} onValueChange={(v) => field.onChange(v === 'base' ? '' : v)}>
            <SelectTrigger className="w-full" aria-label="Unit selected when scanned">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="base">{units[0]?.name || 'Base unit'}</SelectItem>
              {units.slice(1).map((u) => (
                <SelectItem key={u.key} value={u.key}>
                  {u.name || '(unnamed)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <div className="h-9 overflow-hidden">{code?.trim() && BARCODE_RE.test(code.trim()) && <BarcodeSvg value={code.trim()} format={settings.barcodeFormat} height={30} showText={false} className="h-9" />}</div>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove barcode">
        <X />
      </Button>
    </div>
  )
}

function ImageField({ control }: { control: Control<Values> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Controller
      control={control}
      name="imageDataUrl"
      render={({ field }) => (
        <div className="flex items-center gap-4">
          {field.value ? (
            <img src={field.value} alt="Product" className="size-24 rounded-md border object-cover" />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-md border border-dashed text-muted-foreground">
              <ImagePlus className="size-6" aria-hidden />
            </div>
          )}
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setBusy(true)
                try {
                  field.onChange(await resizeImageFile(file))
                } catch (err) {
                  toast.error(errorMessage(err))
                } finally {
                  setBusy(false)
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? 'Processing…' : field.value ? 'Change' : 'Upload'}
            </Button>
            {field.value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange('')}>
                Remove
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Resized to a small thumbnail and stored on this device.</p>
          </div>
        </div>
      )}
    />
  )
}
