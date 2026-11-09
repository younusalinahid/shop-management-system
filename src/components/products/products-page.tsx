'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Download, Eye, ImageOff, MoreHorizontal, Package, Pencil, Percent, Plus, Search, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Pagination, usePagination } from '@/components/shared/pagination'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productEditUrl, productUrl } from '@/constants/navigation'
import type { ID, Product, ProductUnit } from '@/types/db'
import { type CatalogSnapshot, useCatalog, useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { downloadText } from '@/lib/csv'
import { todayDateOnly } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { bestDisplayUnit, formatQty } from '@/lib/units'
import { api } from '@/lib/api-client'
import { categoryPath } from '@/lib/catalog'
import { errorMessage } from '@/lib/errors'
import { ApiError } from '@/lib/errors'
import { BulkPriceDialog } from './bulk-price-dialog'
import { ImportProductsDialog } from './import-products-dialog'

type StatusFilter = 'active' | 'archived' | 'all'
type SortKey = 'name' | 'sku' | 'stock' | 'price' | 'updated'

export function ProductsPage() {
  const catalog = useCatalog()
  const t = useTranslations('products')
  const router = useRouter()
  const refresh = useRefreshData()
  const canEdit = usePermission('products.edit')
  const canEditPrice = usePermission('products.edit_price')
  const canViewCost = usePermission('products.view_cost')

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [categoryId, setCategoryId] = useState('all')
  const [brandId, setBrandId] = useState('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [selected, setSelected] = useState<Set<ID>>(new Set())
  const [dialog, setDialog] = useState<'import' | 'bulk' | null>(null)

  const rows = useMemo(() => (catalog ? filterProducts(catalog, { query, status, categoryId, brandId, lowOnly, sort }) : []), [catalog, query, status, categoryId, brandId, lowOnly, sort])
  const pager = usePagination(rows)

  if (!catalog) return <LoadingState />

  const visibleIds = pager.rows.map((r) => r.product.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggle = (id: ID, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const exportCsv = async (ids?: ID[]) => {
    try {
      // The server leaves purchase prices blank for roles that can't see cost.
      const res = await fetch(`/api/products/export${ids?.length ? `?ids=${ids.join(',')}` : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new ApiError(res.status, 'export_failed', t('exportFailed'))
      downloadText(`products-${todayDateOnly()}.csv`, await res.text())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const changeStatus = async (p: Product, next: 'active' | 'archived') => {
    try {
      await api.patch(`/api/products/${p.id}`, { status: next })
      await refresh()
      toast.success(next === 'archived' ? t('archivedToast', { name: p.name }) : t('restoredToast', { name: p.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const activeCategories = catalog.categories.filter((c) => c.status === 'active')
  const activeBrands = catalog.brands.filter((b) => b.status === 'active')

  return (
    <>
      <PageHeader
        icon={Package}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {canEdit && canEditPrice && (
              <Button variant="outline" onClick={() => setDialog('import')}>
                <Upload /> {t('importCsv')}
              </Button>
            )}
            <Button variant="outline" onClick={() => void exportCsv()} disabled={catalog.products.length === 0}>
              <Download /> {t('exportCsv')}
            </Button>
            {canEdit && (
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> {t('addProduct')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="pl-8"
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // A scanner types the code then Enter: jump straight to a single match.
                  if (e.key === 'Enter' && rows.length === 1) router.push(productUrl(rows[0].product.id))
                }}
                aria-label={t('searchLabel')}
              />
            </div>
            <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="active">{t('active')}</TabsTrigger>
                <TabsTrigger value="archived">{t('archived')}</TabsTrigger>
                <TabsTrigger value="all">{t('all')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label={t('category')} allLabel={t('allCategories')} noneLabel={t('noCategory')} value={categoryId} onChange={setCategoryId} options={activeCategories.map((c) => ({ value: c.id, label: categoryPath(c.id, catalog.categoryById) }))} />
            <FilterSelect label={t('brand')} allLabel={t('allBrands')} noneLabel={t('noBrand')} value={brandId} onChange={setBrandId} options={activeBrands.map((b) => ({ value: b.id, label: b.name }))} />
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-40" aria-label={t('sortBy')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t('sortName')}</SelectItem>
                <SelectItem value="sku">{t('sortSku')}</SelectItem>
                <SelectItem value="stock">{t('sortStock')}</SelectItem>
                <SelectItem value="price">{t('sortPrice')}</SelectItem>
                <SelectItem value="updated">{t('sortUpdated')}</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <Checkbox checked={lowOnly} onCheckedChange={(v) => setLowOnly(v === true)} /> {t('lowStockOnly')}
            </label>
          </div>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{t('selectedCount', { count: selected.size })}</span>
              {canEditPrice && (
                <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}>
                  <Percent /> {t('updatePrices')}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void exportCsv([...selected])}>
                <Download /> {t('exportSelected')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('clear')}
              </Button>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Package}
              title={catalog.products.length === 0 ? t('emptyTitle') : t('noMatchTitle')}
              description={
                catalog.products.length === 0
                  ? t('emptyText')
                  : t('noMatchText')
              }
              action={
                canEdit && catalog.products.length === 0 ? (
                  <Button asChild>
                    <Link href="/products/new">
                      <Plus /> {t('addProduct')}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-0">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(v) => visibleIds.forEach((id) => toggle(id, v === true))}
                      aria-label={t('selectAllPage')}
                    />
                  </TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('categoryBrand')}</TableHead>
                  <TableHead className="text-right">{t('stock')}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t('retailPrice')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map(({ product: p, units, low, sellUnit }) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(productUrl(p.id))}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={t('selectNamed', { name: p.name })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Thumb product={p} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium">
                            {p.name}
                            {p.status === 'archived' && <Badge variant="muted">{t('archived')}</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p.sku} · {units.map((u) => u.name).join(', ')}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      <p>{categoryPath(p.categoryId, catalog.categoryById) || <span className="text-muted-foreground">—</span>}</p>
                      <p className="text-xs text-muted-foreground">{p.brandId ? catalog.brandById.get(p.brandId)?.name : ''}</p>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className={low ? 'font-medium text-destructive' : undefined}>{stockLabel(p, units)}</span>
                      {low && (
                        <Badge variant="warning" className="mt-1">
                          {t('lowStock')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">
                      {sellUnit ? (
                        <>
                          {formatMoney(sellUnit.retailPrice)}
                          <span className="text-xs text-muted-foreground"> / {sellUnit.name}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={productEditUrl(p.id)}>
                              <Pencil /> <span className="hidden md:inline">{t('edit')}</span>
                            </Link>
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={t('actionsFor', { name: p.name })}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => router.push(productUrl(p.id))}>
                              <Eye /> {t('view')}
                            </DropdownMenuItem>
                            {canEdit && (
                              <>
                                <DropdownMenuItem onSelect={() => router.push(productEditUrl(p.id))}>
                                  <Pencil /> {t('edit')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {p.status === 'active' ? (
                                  <DropdownMenuItem onSelect={() => void changeStatus(p, 'archived')}>
                                    <Archive /> {t('archive')}
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => void changeStatus(p, 'active')}>
                                    <ArchiveRestore /> {t('restore')}
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination {...pager} />
          </>
        )}
      </Card>

      {dialog === 'import' && <ImportProductsDialog onClose={() => setDialog(null)} />}
      {dialog === 'bulk' && (
        <BulkPriceDialog
          productIds={[...selected]}
          canViewCost={canViewCost}
          onClose={(done) => {
            setDialog(null)
            if (done) setSelected(new Set())
          }}
        />
      )}
    </>
  )
}

function FilterSelect({
  label,
  allLabel,
  noneLabel,
  value,
  onChange,
  options,
}: {
  label: string
  allLabel: string
  noneLabel: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        <SelectItem value="none">{noneLabel}</SelectItem>
        {options
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

export function Thumb({ product, size = 'size-10' }: { product: Product; size?: string }) {
  return product.imageDataUrl ? (
    <img src={product.imageDataUrl} alt="" className={`${size} shrink-0 rounded-md border object-cover`} />
  ) : (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground`}>
      <ImageOff className="size-4" aria-hidden />
    </div>
  )
}

export function stockLabel(p: Product, units: readonly ProductUnit[]): string {
  const unit = bestDisplayUnit(p.stockQty, units)
  return unit ? formatQty(p.stockQty, unit) : `${p.stockQty} ${p.baseUnitName}`
}

interface Filters {
  query: string
  status: StatusFilter
  categoryId: string
  brandId: string
  lowOnly: boolean
  sort: SortKey
}

function filterProducts(c: CatalogSnapshot, f: Filters) {
  const q = f.query.trim().toLowerCase()
  const list = c.products
    .filter((p) => f.status === 'all' || p.status === f.status)
    .filter((p) => f.categoryId === 'all' || (f.categoryId === 'none' ? !p.categoryId : p.categoryId === f.categoryId))
    .filter((p) => f.brandId === 'all' || (f.brandId === 'none' ? !p.brandId : p.brandId === f.brandId))
    .filter((p) => {
      if (!q) return true
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) return true
      return (c.barcodesByProduct.get(p.id) ?? []).some((b) => b.code.toLowerCase().startsWith(q))
    })
    .map((product) => {
      const units = c.unitsByProduct.get(product.id) ?? []
      return {
        product,
        units,
        sellUnit: units.find((u) => u.canSell),
        low: product.minStockQty > 0 && product.stockQty <= product.minStockQty,
      }
    })
    .filter((r) => !f.lowOnly || r.low)

  const by: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
    name: (a, b) => a.product.name.localeCompare(b.product.name),
    sku: (a, b) => a.product.sku.localeCompare(b.product.sku),
    stock: (a, b) => a.product.stockQty - b.product.stockQty,
    price: (a, b) => (b.sellUnit?.retailPrice ?? 0) - (a.sellUnit?.retailPrice ?? 0),
    updated: (a, b) => b.product.updatedAt - a.product.updatedAt,
  }
  return list.sort(by[f.sort])
}
