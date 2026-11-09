import { db } from '@/db/database'
import type { AuditLog } from '@/types/db'
import { newId } from '@/lib/id'

/** Who is performing an action. Passed explicitly into services (no hidden globals). */
export interface Actor {
  id: string
  name: string
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'System' }

export interface AuditInput {
  action: string
  module: string
  entityId?: string
  before?: unknown
  after?: unknown
  reason?: string
}

/**
 * Append an audit record. When called inside a Dexie transaction that includes
 * `auditLogs`, the write joins that transaction and rolls back with it.
 *
 * NOTE: these logs live in the browser and can be cleared by anyone with device access.
 * They are operational history, not tamper-proof security records.
 */
export async function writeAudit(actor: Actor, input: AuditInput): Promise<AuditLog> {
  const log: AuditLog = {
    id: newId(),
    userId: actor.id,
    userName: actor.name,
    action: input.action,
    module: input.module,
    entityId: input.entityId,
    before: input.before === undefined ? undefined : structuredClone(input.before),
    after: input.after === undefined ? undefined : structuredClone(input.after),
    reason: input.reason,
    createdAt: Date.now(),
  }
  await db.auditLogs.add(log)
  return log
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
