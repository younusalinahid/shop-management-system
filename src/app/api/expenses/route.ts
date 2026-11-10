import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { expenseSchema } from '@/lib/finance'
import { createExpense, listExpenses } from '@/server/services/finance'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const paramsOf = (req: Request) => Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))

const query = z.object({
  from: date.optional(),
  to: date.optional(),
  category: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

export const GET = route(async (req) => {
  await requireActor('expenses.manage')
  return json(await listExpenses(await getDb(), query.parse(paramsOf(req))))
})

export const POST = route(async (req) => {
  const actor = await requireActor('expenses.manage')
  const input = await readBody(req, expenseSchema)
  return json(await createExpense(await getDb(), actor, input), { status: 201 })
})
