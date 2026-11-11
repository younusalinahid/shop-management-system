import { and, count, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm'
import type { DateOnly } from '@/types/db'
import { addDays, startOfDateOnly } from '@/lib/datetime'
import type { Page } from '@/lib/inventory'
import type { Db } from '../db'
import { auditLogs } from '../db/schema'

/** Read side of the audit log (written by writeAudit inside every change's transaction). */

export interface AuditRecord {
  id: string
  userId: string
  userName: string
  action: string
  module: string
  entityId?: string
  before?: unknown
  after?: unknown
  reason?: string
  createdAt: number
}

export interface AuditFilter {
  q?: string
  module?: string
  userId?: string
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listAuditLogs(db: Db, f: AuditFilter): Promise<Page<AuditRecord> & { modules: string[]; users: Array<{ id: string; name: string }> }> {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50))
  const q = f.q?.trim()
  const where = and(
    f.module ? eq(auditLogs.module, f.module) : undefined,
    f.userId ? eq(auditLogs.userId, f.userId) : undefined,
    f.from ? gte(auditLogs.createdAt, startOfDateOnly(f.from)) : undefined,
    f.to ? lt(auditLogs.createdAt, startOfDateOnly(addDays(f.to, 1))) : undefined,
    q ? or(ilike(auditLogs.action, `%${q}%`), ilike(auditLogs.entityId, `%${q}%`), ilike(auditLogs.reason, `%${q}%`), sql`${auditLogs.after}::text ilike ${`%${q}%`}`) : undefined,
  )
  const [rows, [n], modules, people] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(auditLogs).where(where),
    db.selectDistinct({ module: auditLogs.module }).from(auditLogs).orderBy(auditLogs.module),
    db.selectDistinct({ id: auditLogs.userId, name: auditLogs.userName }).from(auditLogs).orderBy(auditLogs.userName),
  ])
  return {
    page,
    pageSize,
    total: n.n,
    modules: modules.map((m) => m.module),
    users: people,
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      action: r.action,
      module: r.module,
      entityId: r.entityId ?? undefined,
      before: r.before ?? undefined,
      after: r.after ?? undefined,
      reason: r.reason ?? undefined,
      createdAt: r.createdAt,
    })),
  }
}
