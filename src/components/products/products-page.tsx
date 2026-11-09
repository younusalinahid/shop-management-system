'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Download, Eye, ImageOff, MoreHorizontal, Package, Pencil, Percent, Plus, Search, Upload } from 'lucide-react'
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
      if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Export failed. Please try again.')
      downloadText(`products-${todayDateOnly()}.csv`, await res.text())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const changeStatus = async (p: Product, next: 'active' | 'archived') => {
    try {
      await api.patch(`/api/products/${p.id}`, { status: next })
      await refresh()
      toast.success(`${p.name} ${next === 'archived' ? 'archived' : 'restored'}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const activeCategories = catalog.categories.filter((c) => c.status === 'active')
  const activeBrands = catalog.brands.filter((b) => b.status === 'active')

  return (
    <>
      <PageHeader
        title="Products"
        description="Products, selling units, prices and barcodes."
        actions={
          <>
            {canEdit && canEditPrice && (
              <Button variant="outline" onClick={() => setDialog('import')}>
                <Upload /> Import CSV
              </Button>
            )}
            <Button variant="outline" onClick={() => void exportCsv()} disabled={catalog.products.length === 0}>
              <Download /> Export CSV
            </Button>
            {canEdit && (
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> Add product
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
                placeholder="Search name, SKU or scan barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // A scanner types the code then Enter: jump straight to a single match.
                  if (e.key === 'Enter' && rows.length === 1) router.push(productUrl(rows[0].product.id))
                }}
                aria-label="Search products"
              />
            </div>
            <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} options={activeCategories.map((c) => ({ value: c.id, label: categoryPath(c.id, catalog.categoryById) }))} />
            <FilterSelect label="Brand" value={brandId} onChange={setBrandId} options={activeBrands.map((b) => ({ value: b.id, label: b.name }))} />
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-40" aria-label="Sort by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="sku">Sort: SKU</SelectItem>
                <SelectItem value="stock">Sort: Lowest stock</SelectItem>
                <SelectItem value="price">Sort: Price</SelectItem>
                <SelectItem value="updated">Sort: Recently updated</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <Checkbox checked={lowOnly} onCheckedChange={(v) => setLowOnly(v === true)} /> Low stock only
            </label>
          </div>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              {canEditPrice && (
                <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}>
                  <Percent /> Update prices
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void exportCsv([...selected])}>
                <Download /> Export selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Package}
              title={catalog.products.length === 0 ? 'No products yet' : 'No products match'}
              description={
                catalog.products.length === 0
                  ? 'Add products one by one, or import a CSV file. Each product can be sold in several units, such as piece and packet.'
                  : 'Try another search, filter or status.'
              }
              action={
                canEdit && catalog.products.length === 0 ? (
                  <Button asChild>
                    <Link href="/products/new">
                      <Plus /> Add product
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
                      aria-label="Select all on this page"
                    />
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden lg:table-cell">Category / Brand</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Retail price</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map(({ product: p, units, low, sellUnit }) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(productUrl(p.id))}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={`Select ${p.name}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Thumb product={p} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium">
                            {p.name}
                            {p.status === 'archived' && <Badge variant="secondary">Archived</Badge>}
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
                      {low && <p className="text-xs text-destructive">Low stock</p>}
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => router.push(productUrl(p.id))}>
                            <Eye /> View
                          </DropdownMenuItem>
                          {canEdit && (
                            <>
                              <DropdownMenuItem onSelect={() => router.push(productEditUrl(p.id))}>
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {p.status === 'active' ? (
                                <DropdownMenuItem onSelect={() => void changeStatus(p, 'archived')}>
                                  <Archive /> Archive
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => void changeStatus(p, 'active')}>
                                  <ArchiveRestore /> Restore
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}s</SelectItem>
        <SelectItem value="none">No {label.toLowerCase()}</SelectItem>
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
