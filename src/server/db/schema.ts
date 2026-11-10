import { sql } from 'drizzle-orm'
import { bigint, boolean, customType, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * PostgreSQL schema (Drizzle). Migrations in /drizzle are generated from this file:
 *   npm run db:generate   (after editing this file)
 *
 * Conventions:
 * - Money is BIGINT poisha (৳1 = 100) and quantities are BIGINT base units, read as JS numbers.
 *   Values stay far below 2^53, so no precision is lost.
 * - Timestamps are TIMESTAMPTZ in the database and epoch milliseconds in the app (`timestampMs`).
 * - Names that must be unique are unique case-insensitively (index on lower(name)).
 * - Records with history are archived (`status`), never deleted.
 */

const timestampMs = customType<{ data: number; driverData: string | Date }>({
  dataType: () => 'timestamp with time zone',
  toDriver: (value) => new Date(value).toISOString(),
  fromDriver: (value) => {
    if (value instanceof Date) return value.getTime()
    // "2026-11-09 07:23:00.123+00" -> ISO 8601
    return Date.parse(value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
  },
})

const money = (name: string) => bigint(name, { mode: 'number' })
const qty = (name: string) => bigint(name, { mode: 'number' })
const status = () => text('status', { enum: ['active', 'archived'] }).notNull().default('active')
const timestamps = {
  createdAt: timestampMs('created_at').notNull(),
  updatedAt: timestampMs('updated_at').notNull(),
}

// ---------------------------------------------------------------- settings, users, sessions

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestampMs('updated_at').notNull(),
})

export const counters = pgTable('counters', {
  id: text('id').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    username: text('username').notNull(),
    role: text('role', { enum: ['owner', 'manager', 'cashier'] }).notNull(),
    pinHash: text('pin_hash').notNull(),
    pinSalt: text('pin_salt').notNull(),
    status: status(),
    lastLoginAt: timestampMs('last_login_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username)],
)

/** Login sessions. `id` is the SHA-256 of the cookie token, so a leaked table can't be replayed. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestampMs('expires_at').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** A user id, or 'system'. */
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    action: text('action').notNull(),
    module: text('module').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_entity_idx').on(t.entityId), index('audit_module_idx').on(t.module, t.action)],
)

// ---------------------------------------------------------------- catalog

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    description: text('description'),
    status: status(),
    ...timestamps,
  },
  (t) => [uniqueIndex('categories_name_uq').on(sql`lower(${t.name})`), index('categories_parent_idx').on(t.parentId)],
)

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: status(),
    ...timestamps,
  },
  (t) => [uniqueIndex('brands_name_uq').on(sql`lower(${t.name})`)],
)

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    categoryId: uuid('category_id').references(() => categories.id),
    brandId: uuid('brand_id').references(() => brands.id),
    description: text('description'),
    imageDataUrl: text('image_data_url'),
    /** Mirrors the base product_units row's name. */
    baseUnitName: text('base_unit_name').notNull(),
    allowFraction: boolean('allow_fraction').notNull(),
    /** Cached stock in base units; changed only with a stock_movements row. */
    stockQty: qty('stock_qty').notNull().default(0),
    /** Cached inventory value (poisha) for weighted-average cost. */
    stockValue: money('stock_value').notNull().default(0),
    minStockQty: qty('min_stock_qty').notNull().default(0),
    /** Basis points: 1500 = 15%. */
    taxRate: integer('tax_rate').notNull().default(0),
    trackBatches: boolean('track_batches').notNull().default(false),
    trackExpiry: boolean('track_expiry').notNull().default(false),
    status: status(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('products_sku_uq').on(t.sku),
    index('products_name_idx').on(t.name),
    index('products_category_idx').on(t.categoryId),
    index('products_brand_idx').on(t.brandId),
    index('products_status_idx').on(t.status),
  ],
)

export const productUnits = pgTable(
  'product_units',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    symbol: text('symbol'),
    /** Base units per one of this unit (1 Sack = 25000 Gram -> 25000). */
    factor: integer('factor').notNull(),
    isBase: boolean('is_base').notNull(),
    canPurchase: boolean('can_purchase').notNull(),
    canSell: boolean('can_sell').notNull(),
    retailPrice: money('retail_price').notNull(),
    wholesalePrice: money('wholesale_price').notNull(),
    purchasePrice: money('purchase_price').notNull(),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [
    index('product_units_product_idx').on(t.productId),
    uniqueIndex('product_units_name_uq').on(t.productId, sql`lower(${t.name})`),
    // Exactly one base unit per product.
    uniqueIndex('product_units_one_base_uq').on(t.productId).where(sql`${t.isBase}`),
  ],
)

export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** When set, scanning selects this unit at the POS. */
    unitId: uuid('unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [uniqueIndex('product_barcodes_code_uq').on(t.code), index('product_barcodes_product_idx').on(t.productId)],
)

// ---------------------------------------------------------------- inventory (written from Phase 3)

export const productBatches = pgTable(
  'product_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    batchNo: text('batch_no').notNull(),
    purchaseId: uuid('purchase_id'),
    receivedAt: timestampMs('received_at').notNull(),
    /** '9999-12-31' when the product has no expiry, so FEFO ordering works on one column. */
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    qtyReceived: qty('qty_received').notNull(),
    qtyRemaining: qty('qty_remaining').notNull(),
    costTotal: money('cost_total').notNull(),
    status: text('status', { enum: ['active', 'depleted', 'expired'] }).notNull(),
    ...timestamps,
  },
  (t) => [index('product_batches_fefo_idx').on(t.productId, t.expiryDate)],
)

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    batchId: uuid('batch_id').references(() => productBatches.id),
    type: text('type').notNull(),
    /** Signed change in base units. */
    qtyChange: qty('qty_change').notNull(),
    /** Signed change in inventory value (poisha). */
    valueChange: money('value_change').notNull(),
    balanceAfter: qty('balance_after').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    reason: text('reason'),
    userId: text('user_id').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('stock_movements_product_idx').on(t.productId, t.createdAt), index('stock_movements_ref_idx').on(t.refId)],
)

// ---------------------------------------------------------------- suppliers and purchases (Phase 3)

/** Minimal supplier record for purchases; full supplier management (payments, ledger) comes in Phase 5. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    companyName: text('company_name'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    openingBalance: money('opening_balance').notNull().default(0),
    /** Cached payable (shop owes the supplier). Changed only together with the document that causes it. */
    balance: money('balance').notNull().default(0),
    status: status(),
    ...timestamps,
  },
  (t) => [uniqueIndex('suppliers_name_uq').on(sql`lower(${t.name})`)],
)

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseNo: text('purchase_no').notNull(),
    /** Client key per "Save purchase" click; a retried request returns the first result. */
    idempotencyKey: text('idempotency_key').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    supplierName: text('supplier_name').notNull(),
    referenceNo: text('reference_no'),
    purchaseDate: date('purchase_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['completed', 'partially_returned', 'returned', 'cancelled'] }).notNull(),
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull(),
    additionalCost: money('additional_cost').notNull(),
    total: money('total').notNull(),
    paid: money('paid').notNull(),
    due: money('due').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    note: text('note'),
    cancelledAt: timestampMs('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchases_no_uq').on(t.purchaseNo),
    uniqueIndex('purchases_idem_uq').on(t.idempotencyKey),
    index('purchases_date_idx').on(t.purchaseDate),
    index('purchases_supplier_idx').on(t.supplierId),
  ],
)

/** Purchase lines keep snapshots (name, unit, factor, cost) so later product edits never change history. */
export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unitId: uuid('unit_id').notNull(),
    unitName: text('unit_name').notNull(),
    unitFactor: integer('unit_factor').notNull(),
    /** Quantity in the purchase unit as an exact decimal string ("2.5"). */
    quantity: text('quantity').notNull(),
    baseQty: qty('base_qty').notNull(),
    unitCost: money('unit_cost').notNull(),
    /** quantity × unitCost, before the invoice discount and additional cost. */
    amount: money('amount').notNull(),
    /** Landed cost: amount − share of discount + share of additional cost. Added to inventory value. */
    lineTotal: money('line_total').notNull(),
    batchId: uuid('batch_id').references(() => productBatches.id),
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date', { mode: 'string' }),
    returnedBaseQty: qty('returned_base_qty').notNull().default(0),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('purchase_items_purchase_idx').on(t.purchaseId), index('purchase_items_product_idx').on(t.productId)],
)

// ---------------------------------------------------------------- customers and sales (Phase 4)

/** Minimal customer record for sales on credit; full customer management arrives in Phase 5. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    openingBalance: money('opening_balance').notNull().default(0),
    /** Cached receivable (customer owes the shop). Changed only together with the document that causes it. */
    balance: money('balance').notNull().default(0),
    priceMode: text('price_mode', { enum: ['retail', 'wholesale'] }),
    notes: text('notes'),
    status: status(),
    ...timestamps,
  },
  (t) => [uniqueIndex('customers_phone_uq').on(t.phone).where(sql`${t.phone} is not null`), index('customers_name_idx').on(t.name)],
)

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNo: text('invoice_no').notNull(),
    /** Client key per "Complete sale" click; a retried request returns the first result. */
    idempotencyKey: text('idempotency_key').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    cashierId: text('cashier_id').notNull(),
    cashierName: text('cashier_name').notNull(),
    priceMode: text('price_mode', { enum: ['retail', 'wholesale'] }).notNull(),
    status: text('status', { enum: ['completed', 'partially_returned', 'returned', 'cancelled'] }).notNull(),
    /** Sum of line amounts (price × quantity) before any discount. */
    subtotal: money('subtotal').notNull(),
    itemDiscountTotal: money('item_discount_total').notNull(),
    invoiceDiscount: money('invoice_discount').notNull(),
    taxTotal: money('tax_total').notNull(),
    total: money('total').notNull(),
    /** Money kept for this sale (excludes change given back). */
    paid: money('paid').notNull(),
    due: money('due').notNull(),
    /** Cash handed in beyond the total, given back. */
    changeGiven: money('change_given').notNull(),
    /** Cost of goods sold (weighted-average cost at sale time). */
    cogs: money('cogs').notNull(),
    note: text('note'),
    cancelledAt: timestampMs('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sales_invoice_uq').on(t.invoiceNo),
    uniqueIndex('sales_idem_uq').on(t.idempotencyKey),
    index('sales_created_idx').on(t.createdAt),
    index('sales_customer_idx').on(t.customerId),
  ],
)

/** Sale lines keep snapshots (name, unit, price, cost) so later product edits never change an invoice. */
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unitId: uuid('unit_id').notNull(),
    unitName: text('unit_name').notNull(),
    unitFactor: integer('unit_factor').notNull(),
    /** Quantity in the selling unit as an exact decimal string ("1.5"). */
    quantity: text('quantity').notNull(),
    baseQty: qty('base_qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    /** price × quantity */
    amount: money('amount').notNull(),
    /** Line discount typed by the cashier. */
    discount: money('discount').notNull(),
    /** Share of the invoice discount. */
    invoiceDiscount: money('invoice_discount').notNull(),
    taxRate: integer('tax_rate').notNull(),
    tax: money('tax').notNull(),
    /** What the customer pays for this line. */
    lineTotal: money('line_total').notNull(),
    costTotal: money('cost_total').notNull(),
    /** Where the stock came from: [{ batchId?, qty, value }]. Cancelling puts it back there. */
    allocations: jsonb('allocations').notNull(),
    returnedBaseQty: qty('returned_base_qty').notNull().default(0),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('sale_items_sale_idx').on(t.saleId), index('sale_items_product_idx').on(t.productId)],
)

export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'other'] }).notNull(),
    /** Amount kept (cash after change). */
    amount: money('amount').notNull(),
    /** Amount handed over (cash only can exceed amount). */
    tendered: money('tendered').notNull(),
    reference: text('reference'),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('sale_payments_sale_idx').on(t.saleId)],
)

/** Parked carts ("hold sale"), resumed later from the POS. */
export const heldSales = pgTable('held_sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  cart: jsonb('cart').notNull(),
  ...timestamps,
})

// ---------------------------------------------------------------- payments and returns (Phase 5)

const methodEnum = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'other'] as const

/**
 * Money received from customers or paid to suppliers outside a sale/purchase: due collections,
 * supplier payments, and refunds made by returns. Never deleted; a mistake is voided (balance restored).
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentNo: text('payment_no').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    partyType: text('party_type', { enum: ['customer', 'supplier'] }).notNull(),
    partyId: uuid('party_id').notNull(),
    partyName: text('party_name').notNull(),
    kind: text('kind', { enum: ['due_collection', 'supplier_payment', 'customer_refund', 'supplier_refund'] }).notNull(),
    /** in = money comes into the shop, out = money leaves the shop. */
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    method: text('method', { enum: methodEnum }).notNull(),
    amount: money('amount').notNull(),
    reference: text('reference'),
    note: text('note'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    voidedAt: timestampMs('voided_at'),
    voidReason: text('void_reason'),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('payments_no_uq').on(t.paymentNo),
    uniqueIndex('payments_idem_uq').on(t.idempotencyKey),
    index('payments_party_idx').on(t.partyType, t.partyId),
    index('payments_created_idx').on(t.createdAt),
  ],
)

export const saleReturns = pgTable(
  'sale_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnNo: text('return_no').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    invoiceNo: text('invoice_no').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    /** Value of the returned goods (what the customer paid for them). */
    total: money('total').notNull(),
    /** Part settled by reducing the customer's due. */
    dueAdjusted: money('due_adjusted').notNull(),
    /** Part paid back to the customer. */
    refund: money('refund').notNull(),
    refundMethod: text('refund_method', { enum: methodEnum }),
    /** Cost put back into stock (resalable items only). */
    costRestocked: money('cost_restocked').notNull(),
    reason: text('reason').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [uniqueIndex('sale_returns_no_uq').on(t.returnNo), uniqueIndex('sale_returns_idem_uq').on(t.idempotencyKey), index('sale_returns_sale_idx').on(t.saleId)],
)

export const saleReturnItems = pgTable(
  'sale_return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => saleReturns.id, { onDelete: 'cascade' }),
    saleItemId: uuid('sale_item_id')
      .notNull()
      .references(() => saleItems.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    unitName: text('unit_name').notNull(),
    unitFactor: integer('unit_factor').notNull(),
    quantity: text('quantity').notNull(),
    baseQty: qty('base_qty').notNull(),
    amount: money('amount').notNull(),
    cost: money('cost').notNull(),
    condition: text('condition', { enum: ['resalable', 'damaged'] }).notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('sale_return_items_return_idx').on(t.returnId), index('sale_return_items_item_idx').on(t.saleItemId)],
)

export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnNo: text('return_no').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    purchaseNo: text('purchase_no').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    supplierName: text('supplier_name').notNull(),
    total: money('total').notNull(),
    /** Part settled by reducing what the shop owes the supplier. */
    payableAdjusted: money('payable_adjusted').notNull(),
    /** Part the supplier paid back. */
    refundReceived: money('refund_received').notNull(),
    refundMethod: text('refund_method', { enum: methodEnum }),
    reason: text('reason').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [uniqueIndex('purchase_returns_no_uq').on(t.returnNo), uniqueIndex('purchase_returns_idem_uq').on(t.idempotencyKey), index('purchase_returns_purchase_idx').on(t.purchaseId)],
)

export const purchaseReturnItems = pgTable(
  'purchase_return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: 'cascade' }),
    purchaseItemId: uuid('purchase_item_id')
      .notNull()
      .references(() => purchaseItems.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    unitName: text('unit_name').notNull(),
    unitFactor: integer('unit_factor').notNull(),
    quantity: text('quantity').notNull(),
    baseQty: qty('base_qty').notNull(),
    amount: money('amount').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('purchase_return_items_return_idx').on(t.returnId), index('purchase_return_items_item_idx').on(t.purchaseItemId)],
)

// ---------------------------------------------------------------- cash, expenses and shifts (Phase 6)

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseNo: text('expense_no').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    category: text('category').notNull(),
    amount: money('amount').notNull(),
    method: text('method', { enum: methodEnum }).notNull(),
    /** Business date of the expense (may differ from when it was entered). */
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    description: text('description'),
    status: text('status', { enum: ['active', 'void'] }).notNull(),
    voidReason: text('void_reason'),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [uniqueIndex('expenses_no_uq').on(t.expenseNo), uniqueIndex('expenses_idem_uq').on(t.idempotencyKey), index('expenses_date_idx').on(t.expenseDate)],
)

/** Money put into or taken out of the cash drawer that is not a sale, purchase or expense. */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['cash_in', 'cash_out'] }).notNull(),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (t) => [index('cash_movements_created_idx').on(t.createdAt)],
)

/**
 * A cashier's working session. Expected cash at close = opening cash + every cash movement the
 * cashier recorded between open and close (sales, collections, refunds, expenses, cash in/out).
 */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    status: text('status', { enum: ['open', 'closed'] }).notNull(),
    openedAt: timestampMs('opened_at').notNull(),
    openingCash: money('opening_cash').notNull(),
    closedAt: timestampMs('closed_at'),
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    /** counted − expected: negative = cash short, positive = cash over. */
    difference: money('difference'),
    note: text('note'),
  },
  (t) => [index('shifts_user_idx').on(t.userId, t.status), index('shifts_opened_idx').on(t.openedAt)],
)
