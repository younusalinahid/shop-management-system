import { z } from 'zod'
import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import { requireActor, route } from '@/server/http'
import { EXPORT_KINDS, type ExportKind, exportCsv } from '@/server/services/export'

type Ctx = { params: Promise<{ kind: string }> }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const NEEDS = { sales: 'sales.view', purchases: 'purchases.manage', customers: 'parties.view', suppliers: 'purchases.manage' } as const

/** GET /api/export/<sales|purchases|customers|suppliers>?from=&to= : CSV for spreadsheets. */
export const GET = route<Ctx>(async (req, { params }) => {
  const kind = (await params).kind as ExportKind
  if (!EXPORT_KINDS.includes(kind)) throw new BusinessError('not_found', 'Unknown export.', { key: 'unknownReport' })
  const actor = await requireActor(NEEDS[kind])
  if (!can(actor.role, 'backup.manage') && !can(actor.role, 'reports.view')) throw new BusinessError('forbidden', 'You do not have permission to do this.')
  const f = z.object({ from: date.optional(), to: date.optional() }).parse(Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== '')))
  const csv = await exportCsv(await getDb(), kind, f)
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}.csv"`, 'Cache-Control': 'no-store' },
  })
})
