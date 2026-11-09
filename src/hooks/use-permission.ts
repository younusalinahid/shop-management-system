import { can, type Permission } from '@/lib/permissions'
import { useOptionalSessionUser } from './use-session'

/** UI-side permission check (hides controls). The API re-checks every request. */
export function usePermission(permission: Permission): boolean {
  return can(useOptionalSessionUser()?.role, permission)
}
