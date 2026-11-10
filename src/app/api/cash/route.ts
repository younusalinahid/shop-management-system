import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { todayDateOnly } from '@/lib/datetime'
import { cashBook } from '@/server/services/finance'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const paramsOf = (req: Request) => Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))

/** GET: the cash book (every money movement) for ?from=&to= (default today), plus cash in drawer. */
export const GET = route(async (req) => {
  await requireActor('cash.manage')
  const f = z.object({ from: date.optional(), to: date.optional() }).parse(paramsOf(req))
  const today = todayDateOnly()
  return json(await cashBook(await getDb(), f.from ?? today, f.to ?? f.from ?? today))
})
