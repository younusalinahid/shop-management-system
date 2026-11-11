import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { listAuditLogs } from '@/server/services/audit-log'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({
  q: z.string().max(100).optional(),
  module: z.string().max(40).optional(),
  userId: z.string().max(60).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

/** GET: the audit log, newest first. */
export const GET = route(async (req) => {
  await requireActor('audit.view')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  return json(await listAuditLogs(await getDb(), query.parse(params)))
})
