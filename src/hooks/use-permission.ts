import { can, type Permission } from '@/lib/permissions'
import { useSession } from '@/stores/session-store'

export function usePermission(permission: Permission): boolean {
  const role = useSession((s) => s.user?.role)
  return can(role, permission)
}
