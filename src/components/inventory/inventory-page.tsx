'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Boxes, CircleSlash, Coins, PackageCheck, Search, SlidersHorizontal, Tags } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Pagination, usePagination } from '@/components/shared/pagination'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productUrl } from '@/constants/navigation'
import { type CatalogSnapshot, useCatalog } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { categoryPath } from '@/lib/catalog'
import { divRound } from '@/lib/decimal'
import { formatMoney, multiplyMoney } from '@/lib/money'
import { formatBreakdown, fromBaseQty } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { ID, Product, ProductUnit } from '@/types/db'
import { AdjustStockDialog } from './adjust-stock-dialog'
import { qtyText } from './qty'

type StockFilter = 'all' | 'in' | 'low' | 'out'

/**
 * Current stock and its value. Cost value is the weighted-average cost of what is on hand
 * (products.stock_value); retail value prices it at each product's first selling unit.
 */
export function InventoryPage() {
  const t = useTranslations('inventory')
  const catalog = useCatalog()
  const canAdjust = usePermission('inventory.adjust')
  const canViewCost = usePermission('products.view_cost')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [categoryId, setCategoryId] = useState('all')
  const [adjusting, setAdjusting] = useState<ID | 'pick' | null>(null)

  const rows = useMemo(() => (catalog ? stockRows(catalog) : []), [catalog])
  const totals = useMemo(() => summarize(rows), [rows])
  const byCategory = useMemo(() => (catalog ? categoryTotals(rows, catalog) : []), [rows, catalog])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => filter === 'all' || r.state === filter || (filter === 'in' && r.state === 'low'))
      .filter((r) => categoryId === 'all' || (categoryId === 'none' ? !r.product.categoryId : r.product.categoryId === categoryId))
      .filter((r) => !q || r.product.name.toLowerCase().includes(q) || r.product.sku.toLowerCase().includes(q))
  }, [rows, query, filter, categoryId])
  const pager = usePagination(filtered)

  if (!catalog) return <LoadingState />

  return (
    <>
      <PageHeader
        icon={Boxes}
        title={t('title')}
        description={t('description')}
        actions={
          canAdjust && (
            <Button onClick={() => setAdjusting('pick')}>
              <SlidersHorizontal /> {t('adjustStock')}
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewCost && <Stat icon={Coins} tone="primary" label={t('costValue')} value={formatMoney(totals.cost)} hint={t('costValueHint')} />}
        <Stat icon={PackageCheck} tone="success" label={t('retailValue')} value={formatMoney(totals.retail)} hint={t('retailValueHint')} />
        <Stat icon={AlertTriangle} tone="warning" label={t('lowStock')} value={String(totals.low)} onClick={() => setFilter('low')} />
        <Stat icon={CircleSlash} tone="danger" label={t('outOfStock')} value={String(totals.out)} onClick={() => setFilter('out')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card className="gap-0 py-0">
          <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input className="pl-8" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
              </div>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-44" aria-label={t('category')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allCategories')}</SelectItem>
                  <SelectItem value="none">{t('noCategory')}</SelectItem>
                  {catalog.categories
                    .filter((c) => c.status === 'active')
                    .map((c) => ({ id: c.id, label: categoryPath(c.id, catalog.categoryById) }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as StockFilter)}>
              <TabsList>
                <TabsTrigger value="all">{t('all')}</TabsTrigger>
                <TabsTrigger value="in">{t('inStock')}</TabsTrigger>
                <TabsTrigger value="low">{t('low')}</TabsTrigger>
                <TabsTrigger value="out">{t('out')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Boxes} title={rows.length === 0 ? t('emptyTitle') : t('noMatch')} description={rows.length === 0 ? t('emptyText') : undefined} />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('product')}</TableHead>
                    <TableHead className="text-right">{t('stock')}</TableHead>
                    {canViewCost && <TableHead className="hidden text-right md:table-cell">{t('avgCost')}</TableHead>}
                    {canViewCost && <TableHead className="hidden text-right sm:table-cell">{t('value')}</TableHead>}
                    {canAdjust && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pager.rows.map((r) => (
                    <TableRow key={r.product.id}>
                      <TableCell>
                        <Link href={productUrl(r.product.id)} className="font-semibold hover:text-primary hover:underline">
                          {r.product.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {r.product.sku}
                          {r.product.categoryId && ` · ${categoryPath(r.product.categoryId, catalog.categoryById)}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <p className={cn('font-semibold', r.state === 'out' && 'text-destructive', r.state === 'low' && 'text-warning-foreground dark:text-warning')}>
                          {qtyText(r.product.stockQty, r.units, r.product.baseUnitName)}
                        </p>
                        {r.product.stockQty > 0 && r.units.length > 1 && (
                          <p className="text-xs text-muted-foreground">{formatBreakdown(r.product.stockQty, r.units, r.product.baseUnitName)}</p>
                        )}
                        {r.state === 'low' && <Badge variant="warning">{t('low')}</Badge>}
                        {r.state === 'out' && <Badge variant="destructive">{t('out')}</Badge>}
                      </TableCell>
                      {canViewCost && (
                        <TableCell className="hidden text-right whitespace-nowrap md:table-cell">
                          {r.avgCost !== undefined && r.costUnit ? (
                            <>
                              {formatMoney(r.avgCost)}
                              <span className="text-xs text-muted-foreground"> / {r.costUnit.name}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      )}
                      {canViewCost && <TableCell className="hidden text-right font-medium sm:table-cell">{formatMoney(r.product.stockValue)}</TableCell>}
                      {canAdjust && (
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setAdjusting(r.product.id)}>
                            <SlidersHorizontal /> <span className="hidden md:inline">{t('adjust')}</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination {...pager} />
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tags className="size-4 text-primary" aria-hidden /> {t('byCategory')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {byCategory.length === 0 && <p className="text-sm text-muted-foreground">{t('noStockYet')}</p>}
            {byCategory.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-primary/5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.id === 'none' ? t('noCategory') : c.label}</span>
                  <span className="text-xs text-muted-foreground">{t('productsInStock', { count: c.inStock })}</span>
                </span>
                <span className="shrink-0 font-semibold">{formatMoney(canViewCost ? c.cost : c.retail)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {adjusting && <AdjustStockDialog productId={adjusting === 'pick' ? undefined : adjusting} onClose={() => setAdjusting(null)} />}
    </>
  )
}

interface StockRow {
  product: Product
  units: ProductUnit[]
  state: 'in' | 'low' | 'out'
  retail: number
  /** Average cost per costUnit (the first selling unit). */
  avgCost?: number
  costUnit?: ProductUnit
}

function stockRows(c: CatalogSnapshot): StockRow[] {
  return c.products
    .filter((p) => p.status === 'active')
    .map((product) => {
      const units = c.unitsByProduct.get(product.id) ?? []
      const sell = units.find((u) => u.canSell && u.retailPrice > 0) ?? units.find((u) => u.canSell)
      const qty = product.stockQty
      const state: StockRow['state'] = qty <= 0 ? 'out' : product.minStockQty > 0 && qty <= product.minStockQty ? 'low' : 'in'
      const retail = qty > 0 && sell ? multiplyMoney(sell.retailPrice, fromBaseQty(qty, sell, 6)) : 0
      const avgCost = qty > 0 && sell ? divRound(BigInt(product.stockValue) * BigInt(sell.factor), BigInt(qty)) : undefined
      return { product, units, state, retail, avgCost, costUnit: sell }
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
}

function summarize(rows: StockRow[]) {
  let cost = 0
  let retail = 0
  let low = 0
  let out = 0
  for (const r of rows) {
    if (r.product.stockQty > 0) cost += r.product.stockValue
    retail += r.retail
    if (r.state === 'low') low++
    if (r.state === 'out') out++
  }
  return { cost, retail, low, out }
}

function categoryTotals(rows: StockRow[], c: CatalogSnapshot) {
  const map = new Map<string, { id: string; label: string; cost: number; retail: number; inStock: number }>()
  for (const r of rows) {
    if (r.product.stockQty <= 0) continue
    const id = r.product.categoryId ?? 'none'
    const entry = map.get(id) ?? { id, label: categoryPath(r.product.categoryId, c.categoryById), cost: 0, retail: 0, inStock: 0 }
    entry.cost += r.product.stockValue
    entry.retail += r.retail
    entry.inStock++
    map.set(id, entry)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.retail - a.retail)
}

const TONES = {
  primary: 'bg-primary/10 text-primary ring-primary/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/20 text-warning-foreground ring-warning/30 dark:text-warning',
  danger: 'bg-destructive/10 text-destructive ring-destructive/20',
} as const

export function Stat({ icon: Icon, tone, label, value, hint, onClick }: { icon: LucideIcon; tone: keyof typeof TONES; label: string; value: string; hint?: string; onClick?: () => void }) {
  const body = (
    <CardContent className="flex items-center gap-4 p-5">
      <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl ring-1', TONES[tone])}>
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="min-w-0 text-left">
        <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-2xl font-bold tracking-tight">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </CardContent>
  )
  return (
    <Card className={cn('gap-0 py-0 transition-all duration-200', onClick && 'hover:-translate-y-0.5 hover:shadow-md')}>
      {onClick ? (
        <button type="button" className="cursor-pointer" onClick={onClick}>
          {body}
        </button>
      ) : (
        body
      )}
    </Card>
  )
}
