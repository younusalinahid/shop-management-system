import { db } from './database'
import type { CashRegister, ExpenseCategory } from '@/types/db'
import { DEFAULT_SETTINGS } from '@/services/settings-service'

export const DEFAULT_REGISTER_ID = 'main-register'

const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Employee Salary',
  'Transportation',
  'Internet',
  'Maintenance',
  'Other',
]

/**
 * Ensure required reference rows exist. Idempotent: safe to run on every start and
 * after a restore. Never overwrites existing data.
 */
export async function ensureDefaults(): Promise<void> {
  await db.transaction('rw', [db.settings, db.cashRegisters, db.expenseCategories], async () => {
    const now = Date.now()
    if (!(await db.settings.get('app'))) {
      await db.settings.add({ ...DEFAULT_SETTINGS, updatedAt: now })
    }
    if (!(await db.cashRegisters.get(DEFAULT_REGISTER_ID))) {
      const reg: CashRegister = { id: DEFAULT_REGISTER_ID, name: 'Main Cash Drawer', status: 'active', createdAt: now, updatedAt: now }
      await db.cashRegisters.add(reg)
    }
    if ((await db.expenseCategories.count()) === 0) {
      const rows: ExpenseCategory[] = DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({
        id: `expcat-${i + 1}`,
        name,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }))
      await db.expenseCategories.bulkAdd(rows)
    }
  })
}
