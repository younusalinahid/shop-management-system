import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { todayDateOnly } from '@/lib/datetime'
import { profitAndLoss } from '@/server/services/finance'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const paramsOf = (req: Request) => Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))

/** GET: profit and loss for ?from=&to= (default today). */
export const GET = route(async (req) => {
  await requireActor('reports.profit')
  const f = z.object({ from: date.optional(), to: date.optional() }).parse(paramsOf(req))
  const today = todayDateOnly()
  return json(await profitAndLoss(await getDb(), f.from ?? today, f.to ?? f.from ?? today))
})
