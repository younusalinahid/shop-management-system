import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/server/db'
import { customers } from '@/server/db/schema'
import { BusinessError } from '@/lib/errors'
import { customerSchema } from '@/lib/sales'
import { json, readBody, requireActor, route } from '@/server/http'
import { setCustomerStatus, toCustomer, updateCustomer } from '@/server/services/customer'
import { customerLedger } from '@/server/services/payment'

type Ctx = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid('v.invalidId')

/** GET: the customer with their account (ledger) built from sales, returns and payments. */
export const GET = route<Ctx>(async (_req, { params }) => {
  await requireActor('parties.view')
  const db = await getDb()
  const id = idSchema.parse((await params).id)
  const [row] = await db.select().from(customers).where(eq(customers.id, id))
  if (!row) throw new BusinessError('not_found', 'Customer not found.', { key: 'customerNotFound' })
  return json({ customer: toCustomer(row), ledger: await customerLedger(db, id) })
})

export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('parties.edit')
  const input = await readBody(req, customerSchema)
  return json(await updateCustomer(await getDb(), actor, idSchema.parse((await params).id), input))
})

/** PATCH: archive or restore. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('parties.edit')
  const body = await readBody(req, z.object({ status: z.enum(['active', 'archived']) }))
  await setCustomerStatus(await getDb(), actor, idSchema.parse((await params).id), body.status)
  return json({ ok: true })
})
