import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { voidSchema } from '@/lib/parties'
import { voidPayment } from '@/server/services/payment'

type Ctx = { params: Promise<{ id: string }> }

/** POST: void a payment entered by mistake (the balance goes back up; the record stays). */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('cash.manage')
  const body = await readBody(req, voidSchema)
  return json(await voidPayment(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body))
})
