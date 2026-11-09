import Dexie, { type EntityTable } from 'dexie'
import type {
  AppSettings,
  AuditLog,
  Brand,
  CashRegister,
  CashTransaction,
  Category,
  Counter,
  Customer,
  Expense,
  ExpenseCategory,
  HeldSale,
  LedgerEntry,
  Payment,
  Product,
  ProductBarcode,
  ProductBatch,
  ProductUnit,
  Purchase,
  PurchaseItem,
  PurchaseReturn,
  PurchaseReturnItem,
  Sale,
  SaleItem,
  SaleReturn,
  SaleReturnItem,
  Shift,
  StockMovement,
  Supplier,
  User,
} from '@/types/db'
import { MIGRATIONS } from './migrations'

export const DB_NAME = 'dokan-pos'

export class PosDatabase extends Dexie {
  settings!: EntityTable<AppSettings, 'id'>
  counters!: EntityTable<Counter, 'id'>
  users!: EntityTable<User, 'id'>
  categories!: EntityTable<Category, 'id'>
  brands!: EntityTable<Brand, 'id'>
  products!: EntityTable<Product, 'id'>
  productUnits!: EntityTable<ProductUnit, 'id'>
  productBarcodes!: EntityTable<ProductBarcode, 'id'>
  productBatches!: EntityTable<ProductBatch, 'id'>
  customers!: EntityTable<Customer, 'id'>
  suppliers!: EntityTable<Supplier, 'id'>
  sales!: EntityTable<Sale, 'id'>
  saleItems!: EntityTable<SaleItem, 'id'>
  heldSales!: EntityTable<HeldSale, 'id'>
  purchases!: EntityTable<Purchase, 'id'>
  purchaseItems!: EntityTable<PurchaseItem, 'id'>
  saleReturns!: EntityTable<SaleReturn, 'id'>
  saleReturnItems!: EntityTable<SaleReturnItem, 'id'>
  purchaseReturns!: EntityTable<PurchaseReturn, 'id'>
  purchaseReturnItems!: EntityTable<PurchaseReturnItem, 'id'>
  payments!: EntityTable<Payment, 'id'>
  expenseCategories!: EntityTable<ExpenseCategory, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>
  cashRegisters!: EntityTable<CashRegister, 'id'>
  cashTransactions!: EntityTable<CashTransaction, 'id'>
  shifts!: EntityTable<Shift, 'id'>
  auditLogs!: EntityTable<AuditLog, 'id'>
  financialLedger!: EntityTable<LedgerEntry, 'id'>

  constructor(name: string = DB_NAME) {
    super(name)
    for (const m of MIGRATIONS) {
      const v = this.version(m.version).stores(m.stores)
      if (m.upgrade) v.upgrade(m.upgrade)
    }
  }
}

/** Current schema version = highest migration version. Stored in backups for compatibility checks. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** Every table name, in a stable order (used by backup/restore). */
export const TABLE_NAMES: readonly string[] = Object.keys(MIGRATIONS[MIGRATIONS.length - 1].stores)

/** The application-wide database instance. Tests create their own instances. */
export const db = new PosDatabase()
