import { db } from '@/db/database'
import type { UserRole } from '@/types/db'
import { can, type Permission } from '@/lib/permissions'
import type { Actor } from './audit-service'
import { BusinessError } from './errors'

/**
 * Re-check a permission inside the service layer (the UI hides controls, services enforce).
 * Call BEFORE opening a write transaction, or include `db.users` in its scope.
 * Local enforcement only; see README "Security limitations".
 */
export async function requirePermission(actor: Actor, ...permissions: Permission[]): Promise<UserRole> {
  const user = await db.users.get(actor.id)
  if (!user || user.status !== 'active') throw new BusinessError('forbidden', 'Your account cannot perform this action.')
  for (const p of permissions) {
    if (!can(user.role, p)) throw new BusinessError('forbidden', 'You do not have permission to do this.')
  }
  return user.role
}
