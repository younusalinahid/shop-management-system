import { z } from 'zod'
import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { todayDateOnly } from '@/lib/datetime'
import { can } from '@/lib/permissions'
import { COST_REPORTS, type ReportName, REPORT_NAMES } from '@/lib/reports'
import { json, requireActor, route } from '@/server/http'
import { hideCostColumns, runReport } from '@/server/services/reports'

type Ctx = { params: Promise<{ name: string }> }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const query = z.object({ from: date.optional(), to: date.optional(), period: z.enum(['day', 'week', 'month', 'year']).default('day') })

/** GET /api/reports/<name>?from=&to=&period= : one report as columns, rows, totals and a suggested chart. */
export const GET = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('reports.view')
  const name = (await params).name as ReportName
  if (!REPORT_NAMES.includes(name)) throw new BusinessError('not_found', 'Unknown report.', { key: 'unknownReport' })
  // Purchase, valuation and profit reports reveal cost.
  if (COST_REPORTS.includes(name) && !can(actor.role, 'reports.profit')) throw new BusinessError('forbidden', 'You do not have permission to do this.')
  const f = query.parse(Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== '')))
  const today = todayDateOnly()
  const result = await runReport(await getDb(), name, { from: f.from ?? today, to: f.to ?? f.from ?? today, period: f.period })
  return json(can(actor.role, 'products.view_cost') ? result : hideCostColumns(result))
})
