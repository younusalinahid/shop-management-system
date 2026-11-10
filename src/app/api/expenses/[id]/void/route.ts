import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { voidSchema } from '@/lib/parties'
import { voidExpense } from '@/server/services/finance'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('expenses.manage')
  const body = await readBody(req, voidSchema)
  return json(await voidExpense(await getDb(), actor, z.string().uuid('v.invalidId').parse((await params).id), body.reason))
})
