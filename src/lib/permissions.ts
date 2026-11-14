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

/** Only owners can manage users, so this can never be handed to a manager or cashier (no way to promote yourself). */
export const OWNER_ONLY: ReadonlySet<Permission> = new Set<Permission>(['users.manage'])

/** Every permission the owner may switch on or off for a manager or cashier. */
export const GRANTABLE_PERMISSIONS: Permission[] = ALL.filter((p) => !OWNER_ONLY.has(p))

/** The checklist the owner sees when setting a user's permissions. Together these cover every grantable permission. */
export const PERMISSION_GROUPS: Array<{ id: string; permissions: Permission[] }> = [
  { id: 'sales', permissions: ['pos.sell', 'sales.view', 'sales.cancel', 'returns.process', 'returns.without_invoice', 'sale.override_expired'] },
  { id: 'catalog', permissions: ['products.view', 'products.edit', 'products.edit_price', 'products.view_cost'] },
  { id: 'inventory', permissions: ['inventory.view', 'inventory.adjust'] },
  { id: 'partiesPurchasing', permissions: ['purchases.manage', 'parties.view', 'parties.edit', 'payments.manage'] },
  { id: 'money', permissions: ['expenses.manage', 'cash.manage', 'shifts.own', 'shifts.all'] },
  { id: 'insights', permissions: ['reports.view', 'reports.profit', 'audit.view'] },
  { id: 'administration', permissions: ['settings.manage', 'backup.manage'] },
]

/** What a role gets when the owner has not customised the user's permissions. */
export const roleDefaults = (role: UserRole): Permission[] => GRANTABLE_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p))

/** A signed-in user for permission checks: their role, plus the owner's custom permission list when one was set. */
export interface PermissionSubject {
  role: UserRole
  /** null / undefined = use the role's default permissions. */
  permissions?: readonly Permission[] | null
}

/**
 * Does this user have the permission? Owners always have everything. For others, a custom list set by
 * the owner replaces the role's defaults; without one the role's defaults apply.
 * A bare role string (no custom list) is still accepted.
 */
export function can(subject: UserRole | PermissionSubject | null | undefined, permission: Permission): boolean {
  if (!subject) return false
  const s: PermissionSubject = typeof subject === 'string' ? { role: subject } : subject
  if (s.role === 'owner') return true
  if (OWNER_ONLY.has(permission)) return false
  return s.permissions ? s.permissions.includes(permission) : ROLE_PERMISSIONS[s.role].has(permission)
}
