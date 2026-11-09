import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import type { Brand, Category, ID, Product, ProductBarcode, ProductUnit } from '@/types/db'

export interface CatalogSnapshot {
  products: Product[]
  unitsByProduct: Map<ID, ProductUnit[]>
  barcodesByProduct: Map<ID, ProductBarcode[]>
  categories: Category[]
  brands: Brand[]
  categoryById: Map<ID, Category>
  brandById: Map<ID, Brand>
}

/** Live view of the whole catalog (re-renders on any product/unit/barcode/category/brand change). */
export function useCatalog(): CatalogSnapshot | undefined {
  return useLiveQuery(async () => {
    const [products, units, barcodes, categories, brands] = await Promise.all([
      db.products.toArray(),
      db.productUnits.toArray(),
      db.productBarcodes.toArray(),
      db.categories.toArray(),
      db.brands.toArray(),
    ])
    const unitsByProduct = new Map<ID, ProductUnit[]>()
    for (const u of units) unitsByProduct.set(u.productId, [...(unitsByProduct.get(u.productId) ?? []), u])
    for (const list of unitsByProduct.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
    const barcodesByProduct = new Map<ID, ProductBarcode[]>()
    for (const b of barcodes) barcodesByProduct.set(b.productId, [...(barcodesByProduct.get(b.productId) ?? []), b])
    return {
      products,
      unitsByProduct,
      barcodesByProduct,
      categories,
      brands,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      brandById: new Map(brands.map((b) => [b.id, b])),
    }
  }, [])
}
