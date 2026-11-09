import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Brand, Category, ID, Product, ProductBarcode, ProductUnit } from '@/types/db'
import { api } from '@/lib/api-client'
import type { CatalogSnapshot as CatalogResponse } from '@/lib/product'

export interface CatalogSnapshot {
  products: Product[]
  unitsByProduct: Map<ID, ProductUnit[]>
  barcodesByProduct: Map<ID, ProductBarcode[]>
  categories: Category[]
  brands: Brand[]
  categoryById: Map<ID, Category>
  brandById: Map<ID, Brand>
}

export const catalogQuery = { queryKey: ['catalog'], queryFn: () => api.get<CatalogResponse>('/api/products') }

/** The whole catalog from GET /api/products, indexed for quick lookups. Undefined while loading. */
export function useCatalog(): CatalogSnapshot | undefined {
  const { data } = useQuery(catalogQuery)
  return useMemo(() => {
    if (!data) return undefined
    const unitsByProduct = new Map<ID, ProductUnit[]>()
    for (const u of data.units) unitsByProduct.set(u.productId, [...(unitsByProduct.get(u.productId) ?? []), u])
    for (const list of unitsByProduct.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
    const barcodesByProduct = new Map<ID, ProductBarcode[]>()
    for (const b of data.barcodes) barcodesByProduct.set(b.productId, [...(barcodesByProduct.get(b.productId) ?? []), b])
    return {
      products: data.products,
      unitsByProduct,
      barcodesByProduct,
      categories: data.categories,
      brands: data.brands,
      categoryById: new Map(data.categories.map((c) => [c.id, c])),
      brandById: new Map(data.brands.map((b) => [b.id, b])),
    }
  }, [data])
}

/** After a successful write: refetch everything that may show the changed data. */
export function useRefreshData() {
  const client = useQueryClient()
  return () => client.invalidateQueries()
}
