import type { Transaction } from 'dexie'

/**
 * Schema history. RULES:
 * 1. Never edit a migration that has shipped. Add a new entry with version + 1 instead.
 * 2. Each entry lists the FULL index spec for every table (Dexie diffs them).
 *    Only indexed fields appear here; other fields are stored without declaration.
 * 3. Put data transformations in `upgrade`. It runs inside a versionchange transaction,
 *    so it is atomic: if it throws, the database stays at the previous version.
 * 4. Update docs/DATABASE.md and bump nothing else — SCHEMA_VERSION derives from this list.
 *
 * Index syntax: first entry = primary key, `&` = unique, `[a+b]` = compound index.
 * Booleans cannot be indexed in IndexedDB; filterable flags use string/number enums.
 */
export interface Migration {
  version: number
  stores: Record<string, string>
  upgrade?: (tx: Transaction) => Promise<void> | void
}

const V1_STORES = {
  settings: 'id',
  counters: 'id',
  users: 'id, &username, role, status',

  categories: 'id, name, parentId, status',
  brands: 'id, name, status',
  products: 'id, name, &sku, categoryId, brandId, status, updatedAt',
  productUnits: 'id, productId, [productId+isBase]',
  productBarcodes: 'id, &code, productId',
  productBatches: 'id, productId, [productId+expiryDate], expiryDate, status, purchaseId',

  customers: 'id, name, phone, status',
  suppliers: 'id, name, phone, status',

  sales: 'id, &invoiceNo, &idempotencyKey, customerId, cashierId, shiftId, status, createdAt',
  saleItems: 'id, saleId, productId, createdAt',
  heldSales: 'id, userId, createdAt',

  purchases: 'id, &purchaseNo, &idempotencyKey, supplierId, status, purchaseDate, createdAt',
  purchaseItems: 'id, purchaseId, productId, batchId, createdAt',

  saleReturns: 'id, &returnNo, &idempotencyKey, saleId, customerId, createdAt',
  saleReturnItems: 'id, returnId, saleItemId, productId, createdAt',
  purchaseReturns: 'id, &returnNo, &idempotencyKey, purchaseId, supplierId, createdAt',
  purchaseReturnItems: 'id, returnId, purchaseItemId, productId, createdAt',

  payments: 'id, &paymentNo, &idempotencyKey, [partyType+partyId], refType, refId, method, shiftId, createdAt',
  expenseCategories: 'id, name, status',
  expenses: 'id, &expenseNo, categoryId, expenseDate, status, shiftId',

  stockMovements: 'id, productId, [productId+createdAt], type, batchId, refId, createdAt',
  cashRegisters: 'id, status',
  cashTransactions: 'id, registerId, shiftId, type, refId, createdAt',
  shifts: 'id, userId, status, [userId+status], openedAt',
  auditLogs: 'id, userId, module, action, entityId, createdAt',
  financialLedger: 'id, entryId, account, [account+partyId], refType, refId, createdAt',
} as const

export const MIGRATIONS: Migration[] = [{ version: 1, stores: V1_STORES }]
