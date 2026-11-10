import { z } from 'zod'
import { getDb } from '@/server/db'
import { can } from '@/lib/permissions'
import { json, readBody, requireActor, route } from '@/server/http'
import { openShiftSchema } from '@/lib/finance'
import { currentShift, listShifts, openShift } from '@/server/services/finance'

const paramsOf = (req: Request) => Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))

/** GET: shift history (all cashiers for shifts.all, otherwise your own) and your open shift. */
export const GET = route(async (req) => {
  const actor = await requireActor('shifts.own')
  const f = z.object({ page: z.coerce.number().int().min(1).optional() }).parse(paramsOf(req))
  const db = await getDb()
  const [history, current] = await Promise.all([listShifts(db, { page: f.page, userId: can(actor.role, 'shifts.all') ? undefined : actor.id }), currentShift(db, actor.id)])
  return json({ ...history, current })
})

/** POST: open your shift with the cash in the drawer. */
export const POST = route(async (req) => {
  const actor = await requireActor('shifts.own')
  const input = await readBody(req, openShiftSchema)
  return json(await openShift(await getDb(), actor, input), { status: 201 })
})
