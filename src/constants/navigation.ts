import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  CalendarClock,
  ClipboardList,
  Clock,
  DatabaseBackup,
  FileBarChart,
  HandCoins,
  LayoutDashboard,
  Package,
  ReceiptText,
  RotateCcw,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  Undo2,
  Users,
  UserCog,
  Wallet,
  WalletCards,
  Award,
  Banknote,
  CreditCard,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  permission: Permission
  /** Implementation phase; pages from later phases render a clear "not built yet" notice. */
  phase: number
}

export interface NavGroup {
  /** Translation key under navGroups.* */
  id: string
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'sales.view', phase: 1 }],
  },
  {
    id: 'sales',
    label: 'Sales',
    items: [
      { path: '/pos', label: 'POS / New Sale', icon: ShoppingCart, permission: 'pos.sell', phase: 4 },
      { path: '/sales', label: 'Sales History', icon: ReceiptText, permission: 'sales.view', phase: 4 },
      { path: '/sales-returns', label: 'Sales Returns', icon: RotateCcw, permission: 'returns.process', phase: 5 },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { path: '/products', label: 'Products', icon: Package, permission: 'products.view', phase: 2 },
      { path: '/categories', label: 'Categories', icon: Tags, permission: 'products.view', phase: 2 },
      { path: '/brands', label: 'Brands', icon: Award, permission: 'products.view', phase: 2 },
      { path: '/barcodes', label: 'Barcode Management', icon: Barcode, permission: 'products.view', phase: 2 },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { path: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.view', phase: 3 },
      { path: '/stock-movements', label: 'Stock Movements', icon: ArrowLeftRight, permission: 'inventory.view', phase: 3 },
      { path: '/batches', label: 'Batches & Expiry', icon: CalendarClock, permission: 'inventory.view', phase: 3 },
    ],
  },
  {
    id: 'purchasing',
    label: 'Purchasing',
    items: [
      { path: '/purchases', label: 'Purchases', icon: Truck, permission: 'purchases.manage', phase: 3 },
      { path: '/purchase-returns', label: 'Purchase Returns', icon: Undo2, permission: 'purchases.manage', phase: 5 },
    ],
  },
  {
    id: 'parties',
    label: 'Parties & Dues',
    items: [
      { path: '/customers', label: 'Customers', icon: Users, permission: 'parties.view', phase: 5 },
      { path: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'parties.view', phase: 5 },
      { path: '/customer-due', label: 'Customer Due', icon: HandCoins, permission: 'payments.manage', phase: 5 },
      { path: '/supplier-due', label: 'Supplier Due', icon: WalletCards, permission: 'purchases.manage', phase: 5 },
      { path: '/payments', label: 'Payments', icon: CreditCard, permission: 'payments.manage', phase: 5 },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { path: '/expenses', label: 'Expenses', icon: Wallet, permission: 'expenses.manage', phase: 6 },
      { path: '/cash', label: 'Cash Management', icon: Banknote, permission: 'cash.manage', phase: 6 },
      { path: '/shifts', label: 'Cashier Shifts', icon: Clock, permission: 'shifts.own', phase: 6 },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { path: '/reports', label: 'Reports', icon: FileBarChart, permission: 'reports.view', phase: 7 },
      { path: '/audit-logs', label: 'Audit Logs', icon: ClipboardList, permission: 'audit.view', phase: 8 },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { path: '/users', label: 'Users & Permissions', icon: UserCog, permission: 'users.manage', phase: 8 },
      { path: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage', phase: 1 },
      { path: '/backup', label: 'Backup & Restore', icon: DatabaseBackup, permission: 'backup.manage', phase: 8 },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** Translation key of a sidebar entry under nav.* (its path without the slash). */
export const navKey = (path: string) => path.slice(1)

/** Routes that are not sidebar entries, as path patterns (":id" matches one segment). */
export const SUB_ROUTES: Array<{ path: string; permission: Permission }> = [
  { path: '/products/new', permission: 'products.edit' },
  { path: '/products/:id/edit', permission: 'products.edit' },
  { path: '/products/:id', permission: 'products.view' },
  { path: '/purchases/new', permission: 'purchases.manage' },
  { path: '/purchases/:id', permission: 'purchases.manage' },
]

export const productUrl = (id: string) => `/products/${encodeURIComponent(id)}`
export const purchaseUrl = (id: string) => `/purchases/${encodeURIComponent(id)}`
export const productEditUrl = (id: string) => `/products/${encodeURIComponent(id)}/edit`

const matches = (pattern: string, path: string) => {
  const a = pattern.split('/')
  const b = path.split('/')
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i])
}

/** Permission needed to open a pathname, or undefined for pages without a rule (e.g. 404). */
export function routePermission(pathname: string): Permission | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (SUB_ROUTES.find((r) => matches(r.path, path)) ?? NAV_ITEMS.find((i) => i.path === path))?.permission
}
