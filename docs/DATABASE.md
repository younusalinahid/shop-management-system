# Database

IndexedDB database `dokan-pos`, accessed through Dexie. The name predates the rename to "Shop Management System"
and must not change: renaming it would hide every existing shop's data. The source of truth for indexes is `src/db/migrations.ts`.
Entity types live in `src/types/db.ts`. Current schema version: **1**.

## Migration process

1. Never edit a shipped migration. Append `{ version: n + 1, stores: {...full spec...}, upgrade }` to `MIGRATIONS`.
2. `upgrade(tx)` runs inside the version-change transaction. If it throws, the database stays on the old version.
3. Only indexed fields appear in `stores`. New non-indexed fields need no migration. Readers must default them,
   as `getSettings()` does by merging over `DEFAULT_SETTINGS`.
4. Backups record `SCHEMA_VERSION`. A restore must reject backups from a newer version.
5. Update this file.

## Conventions

- Primary keys are client UUID strings, except singleton or reference rows: `settings.id = 'app'`,
  `counters.id = 'sale' | …`, `main-register`, and `expcat-N`.
- IndexedDB cannot index booleans, so filterable flags use `status` strings and `productUnits.isBase` uses 0/1.
- `&field` marks a unique index. `[a+b]` marks a compound index.

## Tables (v1)

| Table | Key indexes | Notes |
| --- | --- | --- |
| settings | id | Singleton `'app'` |
| counters | id | Document-number sequences, incremented inside the document's transaction. Also `product` (auto SKU `P00001`) and `barcode` (in-store EAN-13 sequence) |
| users | &username, role, status | PBKDF2 PIN hash + salt |
| categories / brands | name, status (categories: parentId) | Archived, never deleted |
| products | &sku, name, categoryId, brandId, status | Cached `stockQty` (base units) and `stockValue` (poisha) |
| productUnits | productId, [productId+isBase] | `factor` = base units per unit; independent prices |
| productBarcodes | &code, productId | Optional `unitId` lets a scan select a package unit |
| productBatches | productId, [productId+expiryDate], expiryDate, status | FEFO; `9999-12-31` = no expiry |
| customers / suppliers | name, phone, status | Cached `balance`, reconcilable from the ledger |
| sales | &invoiceNo, &idempotencyKey, customerId, cashierId, shiftId, status, createdAt | |
| saleItems | saleId, productId | Snapshots + `baseQty` + `batchAllocations` + `returnedBaseQty` |
| heldSales | userId | Parked carts |
| purchases / purchaseItems | &purchaseNo, &idempotencyKey, supplierId / purchaseId, productId, batchId | |
| saleReturns / saleReturnItems | &returnNo, &idempotencyKey, saleId / returnId, saleItemId | |
| purchaseReturns / purchaseReturnItems | &returnNo, &idempotencyKey, purchaseId / returnId, purchaseItemId | |
| payments | &paymentNo, &idempotencyKey, [partyType+partyId], refType, refId, method, shiftId | In/out; reversals link ids |
| expenseCategories / expenses | name, status / &expenseNo, categoryId, expenseDate | |
| stockMovements | productId, [productId+createdAt], type, batchId, refId | Signed qty and value change, balance after |
| cashRegisters / cashTransactions | status / registerId, shiftId, type, refId | |
| shifts | userId, status, [userId+status] | |
| auditLogs | userId, module, action, entityId, createdAt | Operational history, not tamper-proof |
| financialLedger | entryId, account, [account+partyId], refType, refId | Double-entry lines; Σdebit = Σcredit per entryId |
