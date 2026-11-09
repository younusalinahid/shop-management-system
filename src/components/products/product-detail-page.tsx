'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Printer, Trash2 } from 'lucide-react'
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
import { db } from '@/db/database'
import type { StockMovementType } from '@/types/db'
import { usePermission } from '@/hooks/use-permission'
import { useSettings } from '@/hooks/use-settings'
import { integerToDecimalString } from '@/lib/decimal'
import { formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatBreakdown, formatQty } from '@/lib/units'
import { categoryPath } from '@/services/catalog-service'
import { errorMessage } from '@/services/errors'
import { deleteProduct, getProductDetail, productHasHistory, setProductStatus } from '@/services/product-service'
import { currentActor } from '@/stores/session-store'
import { stockLabel, Thumb } from './products-page'

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  sale: 'Sale',
  sale_return: 'Sale return',
  purchase_return: 'Purchase return',
  adjustment_increase: 'Adjustment +',
  adjustment_decrease: 'Adjustment −',
  damaged: 'Damaged',
  lost: 'Lost',
  expired: 'Expired',
  sale_cancel: 'Sale cancelled',
  purchase_cancel: 'Purchase cancelled',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
}

export function ProductDetailPage() {
  const id = useSearchParams().get('id') ?? ''
  const router = useRouter()
  const settings = useSettings()
  const canEdit = usePermission('products.edit')
  const canViewCost = usePermission('products.view_cost')

  const data = useLiveQuery(async () => {
    const detail = await getProductDetail(id)
    if (!detail) return { detail: null }
    const [categories, hasHistory, movements] = await Promise.all([
      db.categories.toArray(),
      productHasHistory(id),
      db.stockMovements.where('[productId+createdAt]').between([id, 0], [id, Infinity]).reverse().limit(20).toArray(),
    ])
    return { detail, categoryLabel: categoryPath(detail.product.categoryId, new Map(categories.map((c) => [c.id, c]))), hasHistory, movements }
  }, [id])

  if (!data) return <LoadingState />
  if (!data.detail) return <ErrorState title="Product not found" message="It may have been deleted." />

  const { product: p, units, barcodes, brand } = data.detail
  const low = p.minStockQty > 0 && p.stockQty <= p.minStockQty
  const unitName = (unitId?: string) => units.find((u) => u.id === unitId)?.name ?? p.baseUnitName

  const changeStatus = async (next: 'active' | 'archived') => {
    try {
      await setProductStatus(currentActor(), p.id, next)
      toast.success(next === 'archived' ? 'Product archived' : 'Product restored')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title={p.name}
        description={`SKU ${p.sku}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/products">
                <ArrowLeft /> Products
              </Link>
            </Button>
            {canEdit && (
              <>
                {p.status === 'active' ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline">
                        <Archive /> Archive
                      </Button>
                    }
                    title={`Archive ${p.name}?`}
                    description="Archived products are hidden from selling and purchasing. History and stock are kept, and you can restore it any time."
                    confirmLabel="Archive"
                    onConfirm={() => changeStatus('archived')}
                  />
                ) : (
                  <Button variant="outline" onClick={() => void changeStatus('active')}>
                    <ArchiveRestore /> Restore
                  </Button>
                )}
                {!data.hasHistory && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" className="text-destructive">
                        <Trash2 /> Delete
                      </Button>
                    }
                    title={`Delete ${p.name} permanently?`}
                    description="This product has never been bought, sold or stocked, so it can be removed completely. This cannot be undone."
                    confirmLabel="Delete"
                    destructive
                    onConfirm={async () => {
                      try {
                        await deleteProduct(currentActor(), p.id)
                        toast.success('Product deleted')
                        router.push('/products')
                      } catch (e) {
                        toast.error(errorMessage(e))
                      }
                    }}
                  />
                )}
                <Button asChild>
                  <Link href={productEditUrl(p.id)}>
                    <Pencil /> Edit
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
                  <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{p.status === 'active' ? 'Active' : 'Archived'}</Badge>
                  {p.trackBatches && <Badge variant="outline">Batches</Badge>}
                  {p.trackExpiry && <Badge variant="outline">Expiry</Badge>}
                  {p.allowFraction && <Badge variant="outline">Fractional</Badge>}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{data.categoryLabel || '—'}</dd>
              <dt className="text-muted-foreground">Brand</dt>
              <dd>{brand?.name ?? '—'}</dd>
              <dt className="text-muted-foreground">Base unit</dt>
              <dd>{p.baseUnitName}</dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd>{p.taxRate ? `${integerToDecimalString(p.taxRate, 2)}%` : 'None'}</dd>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>{formatDateTime(p.updatedAt)}</dd>
            </dl>
            {p.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{p.description}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock</CardTitle>
            <CardDescription>Counted in {p.baseUnitName}. Changes only through purchases, sales, returns and adjustments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className={`text-3xl font-semibold ${low ? 'text-destructive' : ''}`}>{stockLabel(p, units)}</p>
            {units.length > 1 && <p className="text-sm text-muted-foreground">{formatBreakdown(p.stockQty, units, p.baseUnitName)}</p>}
            <ul className="space-y-1 text-sm">
              {units.map((u) => (
                <li key={u.id} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">in {u.name}</span>
                  <span>{formatQty(p.stockQty, u)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Low-stock alert:{' '}
              {p.minStockQty > 0 ? (
                <>
                  {formatQty(p.minStockQty, units[0] ?? { name: p.baseUnitName, factor: 1 })}
                  {low && <Badge variant="destructive" className="ml-2">Low</Badge>}
                </>
              ) : (
                'off'
              )}
            </p>
            {canViewCost && p.stockQty > 0 && <p className="text-sm text-muted-foreground">Stock value at average cost: {formatMoney(p.stockValue)}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Barcodes</CardTitle>
              <CardDescription>{barcodes.length ? `${barcodes.length} code(s)` : 'None yet'}</CardDescription>
            </div>
            {barcodes.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/barcodes?product=${encodeURIComponent(p.id)}`}>
                  <Printer /> Print labels
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {barcodes.map((b) => (
              <div key={b.id} className="rounded-md border p-2">
                <BarcodeSvg value={b.code} format={settings.barcodeFormat} height={36} className="mx-auto max-w-56" />
                <p className="mt-1 text-center text-xs text-muted-foreground">Selects: {unitName(b.unitId)}</p>
              </div>
            ))}
            {barcodes.length === 0 && canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={productEditUrl(p.id)}>Add a barcode</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 pb-0 lg:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Units &amp; prices</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Contains</TableHead>
                <TableHead className="text-right">Retail</TableHead>
                <TableHead className="text-right">Wholesale</TableHead>
                {canViewCost && <TableHead className="text-right">Purchase cost</TableHead>}
                <TableHead>Use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.symbol && <span className="text-muted-foreground"> ({u.symbol})</span>}
                    {u.isBase === 1 && (
                      <Badge variant="outline" className="ml-2">
                        Base
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{u.isBase ? '—' : `${u.factor.toLocaleString('en-IN')} ${p.baseUnitName}`}</TableCell>
                  <TableCell className="text-right">{formatMoney(u.retailPrice)}</TableCell>
                  <TableCell className="text-right">{formatMoney(u.wholesalePrice)}</TableCell>
                  {canViewCost && <TableCell className="text-right">{formatMoney(u.purchasePrice)}</TableCell>}
                  <TableCell className="text-sm text-muted-foreground">{[u.canSell && 'Sell', u.canPurchase && 'Buy'].filter(Boolean).join(' · ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Recent stock movements</CardTitle>
          </CardHeader>
          <CardContent>
            {data.movements.length === 0 ? (
              <EmptyState title="No stock movements yet" description="Purchases, sales and adjustments will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden md:table-cell">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                      <TableCell>{MOVEMENT_LABELS[m.type]}</TableCell>
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
    </>
  )
}
