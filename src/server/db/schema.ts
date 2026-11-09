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
