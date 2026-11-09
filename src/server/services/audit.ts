import type { UserRole } from '@/types/db'
import { BusinessError } from '@/lib/errors'
import { can, type Permission } from '@/lib/permissions'
import type { Db } from '../db'
import { auditLogs } from '../db/schema'

/** Who is performing an action. Passed explicitly into services (no hidden globals). */
export interface Actor {
  id: string
  name: string
  role: UserRole
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'System', role: 'owner' }

/** Throw 403 unless the actor's role has every permission. Services call this for sensitive actions. */
export function assertCan(actor: Actor, ...permissions: Permission[]) {
  for (const p of permissions) {
    if (!can(actor.role, p)) throw new BusinessError('forbidden', 'You do not have permission to do this.')
  }
}

export interface AuditInput {
  action: string
  module: string
  entityId?: string
  before?: unknown
  after?: unknown
  reason?: string
}

/** Append an audit record. Pass the transaction so it commits or rolls back with the change it describes. */
export async function writeAudit(db: Db, actor: Actor, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    userId: actor.id,
    userName: actor.name,
    action: input.action,
    module: input.module,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : structuredClone(input.before),
    after: input.after === undefined ? null : structuredClone(input.after),
    reason: input.reason ?? null,
    createdAt: Date.now(),
  })
}

/** Shallow diff for audit records: only fields that changed. */
export function diffFields<T extends object>(before: T, after: Partial<T>) {
  const b: Partial<T> = {}
  const a: Partial<T> = {}
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key]
      a[key] = after[key]
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 }
}
