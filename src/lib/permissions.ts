import type { UserRole } from '@/types/db'

/**
 * Role-based permissions. Enforced in the UI (hiding/disabling) and re-checked in
 * services for sensitive actions. Remember: this is local, browser-side enforcement.
 */
export type Permission =
  | 'pos.sell'
  | 'sales.view'
  | 'sales.cancel'
  | 'returns.process'
  | 'returns.without_invoice'
  | 'products.view'
  | 'products.edit'
  | 'products.edit_price'
  | 'products.view_cost'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'purchases.manage'
  | 'parties.view'
  | 'parties.edit'
  | 'payments.manage'
  | 'expenses.manage'
  | 'cash.manage'
  | 'shifts.own'
  | 'shifts.all'
  | 'reports.view'
  | 'reports.profit'
  | 'audit.view'
  | 'users.manage'
  | 'settings.manage'
  | 'backup.manage'
  | 'sale.override_expired'

const CASHIER: Permission[] = [
  'pos.sell',
  'sales.view',
  'products.view',
  'inventory.view',
  'parties.view',
  'payments.manage',
  'shifts.own',
]

const MANAGER: Permission[] = [
  ...CASHIER,
  'sales.cancel',
  'returns.process',
  'products.edit',
  'products.edit_price',
  'products.view_cost',
  'inventory.adjust',
  'purchases.manage',
  'parties.edit',
  'expenses.manage',
  'cash.manage',
  'shifts.all',
  'reports.view',
  'reports.profit',
  'audit.view',
]

const ALL: Permission[] = [
  ...MANAGER,
  'returns.without_invoice',
  'users.manage',
  'settings.manage',
  'backup.manage',
  'sale.override_expired',
]

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  cashier: new Set(CASHIER),
  manager: new Set(MANAGER),
  owner: new Set(ALL),
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner / Admin',
  manager: 'Manager',
  cashier: 'Cashier',
}

export function can(role: UserRole | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].has(permission)
}
