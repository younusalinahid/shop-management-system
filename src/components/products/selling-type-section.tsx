'use client'

import { useId } from 'react'
import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Boxes, Droplets, Package, Scale, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ID } from '@/types/db'
import { cn } from '@/lib/utils'
import { BASE_OF, type SellingKind, type SellingSetup, type UnitRowLike } from './selling-types'

const KINDS: Array<{ kind: SellingKind; icon: LucideIcon }> = [
  { kind: 'piece', icon: Package },
  { kind: 'pack', icon: Boxes },
  { kind: 'weight', icon: Scale },
  { kind: 'liquid', icon: Droplets },
  { kind: 'custom', icon: SlidersHorizontal },
]

/** Big, plain-language choice of how the product is sold. */
export function SellingKindPicker({ value, onChange, lockedBase }: { value: SellingKind; onChange: (k: SellingKind) => void; lockedBase?: string }) {
  const t = useTranslations('productForm.kinds')
  return (
    <div role="radiogroup" aria-label={t('label')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {KINDS.map(({ kind, icon: Icon }) => {
        // Once a product has stock, its counting unit can't change, so only matching options stay open.
        const disabled = !!lockedBase && kind !== 'custom' && BASE_OF[kind].toLowerCase() !== lockedBase.toLowerCase()
        const selected = value === kind
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(kind)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl border-2 bg-card p-4 text-left transition-all duration-150',
              'hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card',
              selected ? 'border-primary bg-primary/[0.06] shadow-sm ring-2 ring-primary/15' : 'border-border',
            )}
          >
            <span className={cn('flex size-10 items-center justify-center rounded-lg', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="font-semibold">{t(`${kind}.title`)}</span>
            <span className="text-xs text-muted-foreground">{t(`${kind}.example`)}</span>
          </button>
        )
      })}
    </div>
  )
}

interface TemplateFieldsProps {
  setup: SellingSetup
  onChange: (patch: Partial<SellingSetup>) => void
  /** Errors of the generated unit rows, shown next to the question that produced them. */
  unitErrors?: FieldErrors<{ units: UnitRowLike[] }>['units']
}

/** The one or two questions each selling type needs. */
export function TemplateFields({ setup, onChange, unitErrors }: TemplateFieldsProps) {
  const t = useTranslations('productForm.kinds')
  const err = (i: number) => (unitErrors as Array<{ qty?: { message?: string } } | undefined> | undefined)?.[i]?.qty?.message

  if (setup.kind === 'piece') return <Hint>{t('piece.hint')}</Hint>

  if (setup.kind === 'pack') {
    const pack = setup.packName.trim() || 'Packet'
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Question label={t('pack.packName')} value={setup.packName} onChange={(v) => onChange({ packName: v })} placeholder="Packet" list="pack-names" />
          <Question
            label={t('pack.packSize', { pack })}
            value={setup.packSize}
            onChange={(v) => onChange({ packSize: v })}
            placeholder="35"
            inputMode="numeric"
            error={err(1)}
          />
        </div>
        <div className="grid gap-4 rounded-lg border border-dashed p-3 sm:grid-cols-2">
          <p className="text-sm text-muted-foreground sm:col-span-2">{t('pack.bigHint')}</p>
          <Question label={t('pack.bigName')} value={setup.bigPackName} onChange={(v) => onChange({ bigPackName: v })} placeholder="Carton" list="pack-names" />
          <Question
            label={t('pack.bigSize', { pack, big: setup.bigPackName.trim() || 'Carton' })}
            value={setup.bigPackSize}
            onChange={(v) => onChange({ bigPackSize: v })}
            placeholder="24"
            inputMode="numeric"
            disabled={!setup.bigPackName.trim()}
            error={err(2)}
          />
        </div>
        <datalist id="pack-names">
          {['Packet', 'Box', 'Dozen', 'Carton', 'Strip', 'Pouch', 'Jar', 'Bag'].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    )
  }

  if (setup.kind === 'weight') {
    return (
      <div className="space-y-4">
        <Hint>{t('weight.hint')}</Hint>
        <div className="grid gap-4 sm:grid-cols-2">
          <Question label={t('weight.sackSize')} value={setup.sackSize} onChange={(v) => onChange({ sackSize: v })} placeholder="25" inputMode="decimal" error={err(2)} hint={t('optional')} />
        </div>
      </div>
    )
  }

  if (setup.kind === 'liquid') {
    return (
      <div className="space-y-4">
        <Hint>{t('liquid.hint')}</Hint>
        <div className="grid gap-4 sm:grid-cols-2">
          <Question label={t('liquid.bottleName')} value={setup.bottleName} onChange={(v) => onChange({ bottleName: v })} placeholder="Bottle" />
          <Question label={t('liquid.bottleSize')} value={setup.bottleSize} onChange={(v) => onChange({ bottleSize: v })} placeholder="500" inputMode="numeric" error={err(2)} hint={t('optional')} />
        </div>
      </div>
    )
  }

  return <Hint>{t('custom.hint')}</Hint>
}

interface PriceTableProps {
  units: UnitRowLike[]
  factors: ReadonlyMap<ID, number>
  register: UseFormRegister<{ units: UnitRowLike[] } & Record<string, unknown>>
  unitErrors?: TemplateFieldsProps['unitErrors']
  canEditPrice: boolean
  canViewCost: boolean
}

/** One row per unit that is sold or bought: selling price first, the rest optional. */
export function PriceTable({ units, factors, register, unitErrors, canEditPrice, canViewCost }: PriceTableProps) {
  const t = useTranslations('productForm.prices')
  const base = units[0]
  const errors = unitErrors as Array<Partial<Record<'retail' | 'wholesale' | 'purchase', { message?: string }>> | undefined> | undefined
  const rows = units.map((u, i) => ({ u, i })).filter(({ u }) => u.canSell || u.canPurchase)

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 bg-muted/60 px-4 py-2 text-xs font-bold tracking-wide text-muted-foreground uppercase sm:grid">
        <span>{t('unit')}</span>
        <span>{t('selling')}</span>
        <span>{t('wholesale')}</span>
        <span>{canViewCost ? t('cost') : ''}</span>
      </div>
      {rows.map(({ u, i }) => {
        const factor = factors.get(u.key)
        return (
          <div key={u.key} className="grid gap-3 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:items-start">
            <div className="pt-1.5">
              <p className="font-semibold">{t('per', { unit: u.name || '—' })}</p>
              {i > 0 && factor !== undefined && (
                <p className="text-xs text-muted-foreground">
                  = {factor.toLocaleString('en-IN')} {base?.name}
                </p>
              )}
            </div>
            <Money label={t('selling')} reg={register(`units.${i}.retail`)} error={errors?.[i]?.retail?.message} disabled={!canEditPrice || !u.canSell} strong />
            <Money label={t('wholesale')} reg={register(`units.${i}.wholesale`)} error={errors?.[i]?.wholesale?.message} disabled={!canEditPrice || !u.canSell} />
            {canViewCost ? (
              <Money label={t('cost')} reg={register(`units.${i}.purchase`)} error={errors?.[i]?.purchase?.message} disabled={!canEditPrice || !u.canPurchase} />
            ) : (
              <span />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Money({ label, reg, error, disabled, strong }: { label: string; reg: ReturnType<UseFormRegister<Record<string, unknown>>>; error?: string; disabled?: boolean; strong?: boolean }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs sm:sr-only">
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">৳</span>
        <Input id={id} inputMode="decimal" placeholder="0.00" className={cn('pl-7', strong && 'font-semibold')} disabled={disabled} {...reg} aria-invalid={!!error} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function Question({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  list,
  disabled,
  error,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'numeric' | 'decimal'
  list?: string
  disabled?: boolean
  error?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} list={list} disabled={disabled} aria-invalid={!!error} />
      {error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-primary/5 px-3 py-2 text-sm text-foreground/80 ring-1 ring-primary/10">{children}</p>
}
