/**
 * Entity types for every IndexedDB table.
 *
 * Conventions (see docs/ARCHITECTURE.md):
 * - `ID` is a string UUID generated on the client (crypto.randomUUID).
 * - `Money` is an INTEGER amount in poisha (1 BDT = 100 poisha). Never a float.
 * - `BaseQty` is an INTEGER quantity in the product's base unit (piece, gram, ml).
 * - `Timestamp` is epoch milliseconds (number), so it can be indexed and range-queried.
 * - `DateOnly` is an ISO calendar date 'YYYY-MM-DD' (e.g. expiry dates), timezone-free.
 * - Booleans are NOT indexable in IndexedDB, so filterable flags use string enums
 *   (e.g. `status: 'active' | 'archived'`).
 * - Document line items (sale/purchase/return items) store historical SNAPSHOTS of
 *   names, units, factors, prices and costs so later product edits never change history.
 */

export type ID = string
export type Money = number
export type BaseQty = number
export type Timestamp = number
export type DateOnly = string
/** Tax/discount rate in basis points: 1500 = 15.00% */
export type BasisPoints = number

export type RecordStatus = 'active' | 'archived'
export type PriceMode = 'retail' | 'wholesale'
export type PaymentMethod = 'cash' | 'card' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'other'
export type UserRole = 'owner' | 'manager' | 'cashier'
export type PartyType = 'customer' | 'supplier'

interface Timestamps {
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ---------------------------------------------------------------- Settings & users

export interface AppSettings {
  id: 'app'
  shopName: string
  shopAddress: string
  shopPhone: string
  logoDataUrl?: string
  currency: 'BDT'
  currencySymbol: string
  locale: string
  timezone: string
  dateFormat: 'DD/MM/YYYY'
  invoicePrefix: string
  purchasePrefix: string
  invoiceFooter: string
  defaultTaxRate: BasisPoints
  pricesIncludeTax: boolean
  defaultPriceMode: PriceMode
  lowStockThreshold: BaseQty
  expiryWarningDays: number
  allowNegativeStock: boolean
  allowExpiredSale: boolean
  allowMultipleOpenShifts: boolean
  requireShiftForSale: boolean
  receiptWidthMm: 58 | 80 | 210
  barcodeFormat: 'CODE128' | 'EAN13'
  autoBackupReminderDays: number
  lastBackupAt?: Timestamp
  schemaVersion: number
  updatedAt: Timestamp
}

export interface User extends Timestamps {
  id: ID
  name: string
  username: string
  role: UserRole
  /** PBKDF2-SHA256 hash of the PIN/password, hex. Local-only; not server-grade security. */
  pinHash: string
  pinSalt: string
  status: RecordStatus
  lastLoginAt?: Timestamp
}

/** Monotonic counters used to generate human-readable document numbers. */
export interface Counter {
  id: 'sale' | 'purchase' | 'saleReturn' | 'purchaseReturn' | 'expense' | 'payment' | 'product' | 'barcode'
  value: number
}

// ---------------------------------------------------------------- Catalog

export interface Category extends Timestamps {
  id: ID
  name: string
  parentId?: ID
  description?: string
  status: RecordStatus
}

export interface Brand extends Timestamps {
  id: ID
  name: string
  description?: string
  status: RecordStatus
}

export interface Product extends Timestamps {
  id: ID
  name: string
  sku: string
  categoryId?: ID
  brandId?: ID
  description?: string
  imageDataUrl?: string
  /** Name of the base unit (e.g. 'Piece', 'Gram', 'ML'). Mirrors the productUnits row with isBase. */
  baseUnitName: string
  /** Whether fractional quantities of *selling units* are allowed (e.g. 1.5 KG). Base qty stays integer. */
  allowFraction: boolean
  /** Cached current stock in base units. Changed ONLY by InventoryService alongside a stockMovement. */
  stockQty: BaseQty
  /**
   * Cached total inventory value (poisha) for weighted-average costing.
   * Average cost per base unit = stockValue / stockQty. Keeping the total (not a per-unit
   * average) avoids precision loss for tiny base units such as grams.
   */
  stockValue: Money
  minStockQty: BaseQty
  taxRate: BasisPoints
  trackBatches: boolean
  trackExpiry: boolean
  status: RecordStatus
}

/**
 * One unit of measure for a product. Exactly one row per product has isBase = 1 and factor = 1.
 * `factor` = how many BASE units one of this unit contains (1 Sack = 25000 Gram -> factor 25000).
 * Prices are per ONE of this unit and are independent (packet price != piece price × 35).
 */
export interface ProductUnit extends Timestamps {
  id: ID
  productId: ID
  name: string
  symbol?: string
  factor: number
  /** 1 | 0 rather than boolean so it can be indexed. */
  isBase: 0 | 1
  canPurchase: boolean
  canSell: boolean
  retailPrice: Money
  wholesalePrice: Money
  /** Default purchase cost per one of this unit (suggestion only). */
  purchasePrice: Money
  sortOrder: number
}

export interface ProductBarcode {
  id: ID
  /** Unique across all products. */
  code: string
  productId: ID
  /** When set, scanning selects this unit in the POS (e.g. a carton barcode). */
  unitId?: ID
  createdAt: Timestamp
}

export interface ProductBatch extends Timestamps {
  id: ID
  productId: ID
  batchNo: string
  purchaseId?: ID
  receivedAt: Timestamp
  /** '9999-12-31' when the product has no expiry, so FEFO ordering works on one index. */
  expiryDate: DateOnly
  qtyReceived: BaseQty
  qtyRemaining: BaseQty
  /** Total cost (poisha) of qtyReceived. */
  costTotal: Money
  status: 'active' | 'depleted' | 'expired'
}

// ---------------------------------------------------------------- Parties

export interface Customer extends Timestamps {
  id: ID
  name: string
  phone?: string
  email?: string
  address?: string
  /** Positive = customer owes the shop at the time of onboarding. */
  openingBalance: Money
  /** Cached receivable; source of truth is financialLedger (account 'receivable'). Reconcilable. */
  balance: Money
  priceMode?: PriceMode
  discountRate?: BasisPoints
  notes?: string
  status: RecordStatus
}

export interface Supplier extends Timestamps {
  id: ID
  name: string
  companyName?: string
  phone?: string
  email?: string
  address?: string
  /** Positive = shop owes the supplier at the time of onboarding. */
  openingBalance: Money
  /** Cached payable; source of truth is financialLedger (account 'payable'). Reconcilable. */
  balance: Money
  notes?: string
  status: RecordStatus
}

// ---------------------------------------------------------------- Sales

export type SaleStatus = 'completed' | 'partially_returned' | 'returned' | 'cancelled'

export interface Sale extends Timestamps {
  id: ID
  invoiceNo: string
  /** Client-generated key; unique index prevents duplicate submissions. */
  idempotencyKey: string
  customerId?: ID
  customerName: string
  cashierId: ID
  shiftId?: ID
  priceMode: PriceMode
  status: SaleStatus
  subtotal: Money
  itemDiscountTotal: Money
  invoiceDiscount: Money
  taxTotal: Money
  total: Money
  paid: Money
  /** Amount left as customer due at sale time. */
  due: Money
  changeGiven: Money
  /** Cost of goods sold, from weighted-average cost at sale time. */
  cogs: Money
  note?: string
  cancelledAt?: Timestamp
  cancelReason?: string
}

export interface BatchAllocation {
  batchId: ID
  qty: BaseQty
  cost: Money
}

export interface SaleItem {
  id: ID
  saleId: ID
  productId: ID
  // snapshots
  productName: string
  sku: string
  unitId: ID
  unitName: string
  unitFactor: number
  /** Quantity in the selling unit (may be fractional, e.g. 1.5 KG). */
  quantity: number
  /** Authoritative integer quantity in base units (1.5 KG -> 1500). */
  baseQty: BaseQty
  unitPrice: Money
  discount: Money
  taxRate: BasisPoints
  tax: Money
  lineTotal: Money
  costTotal: Money
  batchAllocations: BatchAllocation[]
  returnedBaseQty: BaseQty
  createdAt: Timestamp
}

export interface HeldSale extends Timestamps {
  id: ID
  label: string
  userId: ID
  customerId?: ID
  priceMode: PriceMode
  /** Serialized cart state (opaque to the DB). */
  cart: unknown
}

// ---------------------------------------------------------------- Purchases

export type PurchaseStatus = 'completed' | 'partially_returned' | 'returned' | 'cancelled'

export interface Purchase extends Timestamps {
  id: ID
  purchaseNo: string
  idempotencyKey: string
  supplierId?: ID
  supplierName: string
  referenceNo?: string
  purchaseDate: Timestamp
  status: PurchaseStatus
  subtotal: Money
  discount: Money
  additionalCost: Money
  taxTotal: Money
  total: Money
  paid: Money
  due: Money
  userId: ID
  note?: string
  cancelledAt?: Timestamp
  cancelReason?: string
}

export interface PurchaseItem {
  id: ID
  purchaseId: ID
  productId: ID
  productName: string
  sku: string
  unitId: ID
  unitName: string
  unitFactor: number
  quantity: number
  baseQty: BaseQty
  unitCost: Money
  discount: Money
  tax: Money
  /** Landed line cost incl. allocated additional cost; added to inventory value. */
  lineTotal: Money
  batchId?: ID
  batchNo?: string
  expiryDate?: DateOnly
  returnedBaseQty: BaseQty
  createdAt: Timestamp
}

// ---------------------------------------------------------------- Returns

export type ReturnCondition = 'resalable' | 'damaged'

export interface SaleReturn {
  id: ID
  returnNo: string
  idempotencyKey: string
  saleId?: ID
  invoiceNo?: string
  customerId?: ID
  userId: ID
  shiftId?: ID
  subtotal: Money
  refundTotal: Money
  /** Portion settled by reducing customer due instead of paying out. */
  dueAdjusted: Money
  cogsReversed: Money
  reason: string
  createdAt: Timestamp
}

export interface SaleReturnItem {
  id: ID
  returnId: ID
  saleItemId?: ID
  productId: ID
  productName: string
  unitName: string
  unitFactor: number
  quantity: number
  baseQty: BaseQty
  unitPrice: Money
  amount: Money
  cost: Money
  condition: ReturnCondition
  createdAt: Timestamp
}

export interface PurchaseReturn {
  id: ID
  returnNo: string
  idempotencyKey: string
  purchaseId: ID
  purchaseNo: string
  supplierId?: ID
  userId: ID
  total: Money
  refundReceived: Money
  payableAdjusted: Money
  reason: string
  createdAt: Timestamp
}

export interface PurchaseReturnItem {
  id: ID
  returnId: ID
  purchaseItemId: ID
  productId: ID
  productName: string
  unitName: string
  unitFactor: number
  quantity: number
  baseQty: BaseQty
  unitCost: Money
  amount: Money
  batchId?: ID
  createdAt: Timestamp
}

// ---------------------------------------------------------------- Money movement

export type PaymentRefType =
  | 'sale'
  | 'purchase'
  | 'sale_return'
  | 'purchase_return'
  | 'due_collection'
  | 'supplier_payment'
  | 'expense'

export interface Payment {
  id: ID
  paymentNo: string
  idempotencyKey: string
  /** 'in' = money received by the shop, 'out' = money paid by the shop. */
  direction: 'in' | 'out'
  method: PaymentMethod
  amount: Money
  partyType?: PartyType
  partyId?: ID
  refType: PaymentRefType
  refId?: ID
  shiftId?: ID
  userId: ID
  note?: string
  /** Set when reversed by a cancellation; original rows are never deleted. */
  reversedById?: ID
  reversalOfId?: ID
  createdAt: Timestamp
}

export interface ExpenseCategory extends Timestamps {
  id: ID
  name: string
  status: RecordStatus
}

export interface Expense extends Timestamps {
  id: ID
  expenseNo: string
  categoryId: ID
  categoryName: string
  amount: Money
  method: PaymentMethod
  /** Business date of the expense (may differ from createdAt). */
  expenseDate: Timestamp
  description?: string
  userId: ID
  shiftId?: ID
  status: 'active' | 'void'
}

export type StockMovementType =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'sale_return'
  | 'purchase_return'
  | 'adjustment_increase'
  | 'adjustment_decrease'
  | 'damaged'
  | 'lost'
  | 'expired'
  | 'sale_cancel'
  | 'purchase_cancel'
  | 'transfer_in'
  | 'transfer_out'

export interface StockMovement {
  id: ID
  productId: ID
  batchId?: ID
  type: StockMovementType
  /** Signed change in base units (+ in, − out). */
  qtyChange: BaseQty
  /** Signed change in inventory value (poisha). */
  valueChange: Money
  balanceAfter: BaseQty
  refType?: string
  refId?: ID
  /** Reserved for future multi-location support. */
  locationId?: ID
  reason?: string
  userId: ID
  createdAt: Timestamp
}

export interface CashRegister extends Timestamps {
  id: ID
  name: string
  status: RecordStatus
}

export type CashTxnType =
  | 'opening'
  | 'sale'
  | 'due_collection'
  | 'purchase'
  | 'supplier_payment'
  | 'refund'
  | 'expense'
  | 'cash_in'
  | 'cash_out'
  | 'reversal'
  | 'closing_adjustment'

export interface CashTransaction {
  id: ID
  registerId: ID
  shiftId?: ID
  type: CashTxnType
  direction: 'in' | 'out'
  amount: Money
  refType?: string
  refId?: ID
  note?: string
  userId: ID
  createdAt: Timestamp
}

export interface Shift {
  id: ID
  userId: ID
  userName: string
  registerId: ID
  status: 'open' | 'closed'
  openedAt: Timestamp
  closedAt?: Timestamp
  openingCash: Money
  expectedCash?: Money
  actualCash?: Money
  difference?: Money
  note?: string
}

/** Chart of accounts used by the double-entry financial ledger. */
export type LedgerAccount =
  | 'cash'
  | 'card'
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'bank'
  | 'other_payment'
  | 'receivable'
  | 'payable'
  | 'inventory'
  | 'sales_revenue'
  | 'sales_returns'
  | 'sales_discount'
  | 'tax_payable'
  | 'cogs'
  | 'expense'
  | 'inventory_loss'
  | 'owner_equity'
  | 'cash_over_short'

/**
 * One line of a balanced journal entry. All lines with the same `entryId` must have
 * sum(debit) === sum(credit). Entries are append-only; corrections are reversal entries.
 */
export interface LedgerEntry {
  id: ID
  entryId: ID
  account: LedgerAccount
  debit: Money
  credit: Money
  partyType?: PartyType
  partyId?: ID
  refType: string
  refId?: ID
  memo?: string
  createdAt: Timestamp
}

export interface AuditLog {
  id: ID
  userId: ID
  userName: string
  action: string
  module: string
  entityId?: ID
  before?: unknown
  after?: unknown
  reason?: string
  createdAt: Timestamp
}
