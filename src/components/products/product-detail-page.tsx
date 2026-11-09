'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Printer, SlidersHorizontal, Trash2 } from 'lucide-react'
import { AdjustStockDialog } from '@/components/inventory/adjust-stock-dialog'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BarcodeSvg } from '@/components/shared/barcode-svg'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { productEditUrl } from '@/constants/navigation'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { integerToDecimalString } from '@/lib/decimal'
import { formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatBreakdown, formatQty } from '@/lib/units'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { categoryPath } from '@/lib/catalog'
import type { ProductDetail } from '@/lib/product'
import type { Category } from '@/types/db'
import { errorMessage } from '@/lib/errors'
import { stockLabel, Thumb } from './products-page'

export function ProductDetailPage({ id }: { id: string }) {
  const router = useRouter()
  const t = useTranslations('productDetail')
  const tm = useTranslations('movement')
  const refresh = useRefreshData()
  const settings = useSettings()
  const canEdit = usePermission('products.edit')
  const canViewCost = usePermission('products.view_cost')
  const canAdjust = usePermission('inventory.adjust')
  const [adjusting, setAdjusting] = useState(false)

  const detail = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDetail>(`/api/products/${id}`) })
  const cats = useQuery({ queryKey: ['category'], queryFn: () => api.get<{ items: Category[] }>('/api/categories') })

  if (detail.isPending) return <LoadingState />
  if (detail.isError) return <ErrorState title={t('loadError')} message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />

  const data = {
    hasHistory: detail.data.hasHistory,
    movements: detail.data.recentMovements,
    categoryLabel: categoryPath(detail.data.product.categoryId, new Map((cats.data?.items ?? []).map((c) => [c.id, c]))),
  }
  const { product: p, units, barcodes, brand } = detail.data
  const low = p.minStockQty > 0 && p.stockQty <= p.minStockQty
  const unitName = (unitId?: string) => units.find((u) => u.id === unitId)?.name ?? p.baseUnitName

  const changeStatus = async (next: 'active' | 'archived') => {
    try {
      await api.patch(`/api/products/${p.id}`, { status: next })
      await refresh()
      toast.success(next === 'archived' ? t('archivedToast') : t('restoredToast'))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title={p.name}
        description={t('sku', { sku: p.sku })}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/products">
                <ArrowLeft /> {t('back')}
              </Link>
            </Button>
            {canAdjust && p.status === 'active' && (
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                <SlidersHorizontal /> {t('adjustStock')}
              </Button>
            )}
            {canEdit && (
              <>
                {p.status === 'active' ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline">
                        <Archive /> {t('archive')}
                      </Button>
                    }
                    title={t('archiveConfirmTitle', { name: p.name })}
                    description={t('archiveConfirmText')}
                    confirmLabel={t('archive')}
                    onConfirm={() => changeStatus('archived')}
                  />
                ) : (
                  <Button variant="outline" onClick={() => void changeStatus('active')}>
                    <ArchiveRestore /> {t('restore')}
                  </Button>
                )}
                {!data.hasHistory && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" className="text-destructive">
                        <Trash2 /> {t('delete')}
                      </Button>
                    }
                    title={t('deleteConfirmTitle', { name: p.name })}
                    description={t('deleteConfirmText')}
                    confirmLabel={t('delete')}
                    destructive
                    onConfirm={async () => {
                      try {
                        await api.delete(`/api/products/${p.id}`)
                        await refresh()
                        toast.success(t('deletedToast'))
                        router.push('/products')
                      } catch (e) {
                        toast.error(errorMessage(e))
                      }
                    }}
                  />
                )}
                <Button asChild>
                  <Link href={productEditUrl(p.id)}>
                    <Pencil /> {t('edit')}
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-4">
              <Thumb product={p} size="size-20" />
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                  <Badge variant={p.status === 'active' ? 'success' : 'muted'}>{p.status === 'active' ? t('active') : t('archived')}</Badge>
                  {p.trackBatches && <Badge variant="outline">{t('batches')}</Badge>}
                  {p.trackExpiry && <Badge variant="outline">{t('expiry')}</Badge>}
                  {p.allowFraction && <Badge variant="outline">{t('fractional')}</Badge>}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('category')}</dt>
              <dd>{data.categoryLabel || '—'}</dd>
              <dt className="text-muted-foreground">{t('brand')}</dt>
              <dd>{brand?.name ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('baseUnit')}</dt>
              <dd>{p.baseUnitName}</dd>
              <dt className="text-muted-foreground">{t('tax')}</dt>
              <dd>{p.taxRate ? `${integerToDecimalString(p.taxRate, 2)}%` : t('none')}</dd>
              <dt className="text-muted-foreground">{t('updated')}</dt>
              <dd>{formatDateTime(p.updatedAt)}</dd>
            </dl>
            {p.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{p.description}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('stock')}</CardTitle>
            <CardDescription>{t('stockHint', { unit: p.baseUnitName })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className={`text-3xl font-semibold ${low ? 'text-destructive' : ''}`}>{stockLabel(p, units)}</p>
            {units.length > 1 && <p className="text-sm text-muted-foreground">{formatBreakdown(p.stockQty, units, p.baseUnitName)}</p>}
            <ul className="space-y-1 text-sm">
              {units.map((u) => (
                <li key={u.id} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('inUnit', { unit: u.name })}</span>
                  <span>{formatQty(p.stockQty, u)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {t('lowStockAlert')}{' '}
              {p.minStockQty > 0 ? (
                <>
                  {formatQty(p.minStockQty, units[0] ?? { name: p.baseUnitName, factor: 1 })}
                  {low && (
                    <Badge variant="warning" className="ml-2">
                      {t('low')}
                    </Badge>
                  )}
                </>
              ) : (
                t('off')
              )}
            </p>
            {canViewCost && p.stockQty > 0 && <p className="text-sm text-muted-foreground">{t('stockValue', { value: formatMoney(p.stockValue) })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{t('barcodes')}</CardTitle>
              <CardDescription>{barcodes.length ? t('codeCount', { count: barcodes.length }) : t('noneYet')}</CardDescription>
            </div>
            {barcodes.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/barcodes?product=${encodeURIComponent(p.id)}`}>
                  <Printer /> {t('printLabels')}
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {barcodes.map((b) => (
              <div key={b.id} className="rounded-md border p-2">
                <BarcodeSvg value={b.code} format={settings.barcodeFormat} height={36} className="mx-auto max-w-56" />
                <p className="mt-1 text-center text-xs text-muted-foreground">{t('selects', { unit: unitName(b.unitId) })}</p>
              </div>
            ))}
            {barcodes.length === 0 && canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={productEditUrl(p.id)}>{t('addBarcode')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 pb-0 lg:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t('unitsPrices')}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('unit')}</TableHead>
                <TableHead>{t('contains')}</TableHead>
                <TableHead className="text-right">{t('retail')}</TableHead>
                <TableHead className="text-right">{t('wholesale')}</TableHead>
                {canViewCost && <TableHead className="text-right">{t('purchaseCost')}</TableHead>}
                <TableHead>{t('use')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.symbol && <span className="text-muted-foreground"> ({u.symbol})</span>}
                    {u.isBase && (
                      <Badge variant="outline" className="ml-2">
                        {t('base')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{u.isBase ? '—' : `${u.factor.toLocaleString('en-IN')} ${p.baseUnitName}`}</TableCell>
                  <TableCell className="text-right">{formatMoney(u.retailPrice)}</TableCell>
                  <TableCell className="text-right">{formatMoney(u.wholesalePrice)}</TableCell>
                  {canViewCost && <TableCell className="text-right">{formatMoney(u.purchasePrice)}</TableCell>}
                  <TableCell className="text-sm text-muted-foreground">{[u.canSell && t('sell'), u.canPurchase && t('buy')].filter(Boolean).join(' · ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('recentMovements')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.movements.length === 0 ? (
              <EmptyState title={t('noMovementsTitle')} description={t('noMovementsText')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('date')}</TableHead>
                    <TableHead>{t('type')}</TableHead>
                    <TableHead className="text-right">{t('change')}</TableHead>
                    <TableHead className="text-right">{t('balance')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                      <TableCell>{tm(m.type)}</TableCell>
                      <TableCell className={`text-right ${m.qtyChange < 0 ? 'text-destructive' : ''}`}>
                        {m.qtyChange > 0 ? '+' : ''}
                        {m.qtyChange.toLocaleString('en-IN')} {p.baseUnitName}
                      </TableCell>
                      <TableCell className="text-right">{m.balanceAfter.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{m.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      {adjusting && (
        <AdjustStockDialog
          productId={p.id}
          defaultType={detail.data.hasHistory ? 'adjustment_increase' : 'opening'}
          onClose={() => {
            setAdjusting(false)
            void detail.refetch()
          }}
        />
      )}
    </>
  )
}
