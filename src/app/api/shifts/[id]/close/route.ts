import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { closeShiftSchema } from '@/lib/finance'
import { closeShift } from '@/server/services/finance'

type Ctx = { params: Promise<{ id: string }> }

/** POST: close a shift with the counted cash; the difference from the expected cash is recorded. */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('shifts.own')
  const body = await readBody(req, closeShiftSchema)
  return json(await closeShift(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body))
})
