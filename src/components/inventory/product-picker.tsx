'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { CatalogSnapshot } from '@/hooks/use-catalog'
import type { ID, Product } from '@/types/db'
import { cn } from '@/lib/utils'
import { stockLabel } from '@/components/products/products-page'

/**
 * Searchable product picker (name, SKU or barcode). A scanner types the barcode and Enter, which picks
 * the single match. `value` undefined shows the placeholder; with `allowAll` an "All products" row clears it.
 */
export function ProductPicker({
  catalog,
  value,
  onChange,
  placeholder,
  allowAll,
  filter = (p) => p.status === 'active',
  className,
  id,
  resetAfterPick,
}: {
  catalog: CatalogSnapshot
  value?: ID
  onChange: (id: ID | undefined) => void
  placeholder?: string
  allowAll?: boolean
  filter?: (p: Product) => boolean
  className?: string
  id?: string
  /** Clear the trigger after each pick (adding lines to a purchase). */
  resetAfterPick?: boolean
}) {
  const t = useTranslations('picker')
  const [open, setOpen] = useState(false)
  const selected = value ? catalog.products.find((p) => p.id === value) : undefined
  const list = catalog.products.filter(filter)
  const label = selected && !resetAfterPick ? selected.name : (placeholder ?? t('placeholder'))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={id ? undefined : label} className={cn('w-full justify-between font-normal', className)}>
          <span className={cn('flex min-w-0 items-center gap-2 truncate', !selected && 'text-muted-foreground')}>
            {!selected && <Search className="size-4 shrink-0" aria-hidden />}
            {label}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{t('none')}</CommandEmpty>
            <CommandGroup>
              {allowAll && (
                <CommandItem
                  value="__all__"
                  onSelect={() => {
                    onChange(undefined)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value ? 'opacity-0' : 'opacity-100')} />
                  {t('all')}
                </CommandItem>
              )}
              {list.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  keywords={[p.name, p.sku, ...(catalog.barcodesByProduct.get(p.id) ?? []).map((b) => b.code)]}
                  onSelect={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === p.id && !resetAfterPick ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.sku} · {t('inStock', { qty: stockLabel(p, catalog.unitsByProduct.get(p.id) ?? []) })}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
