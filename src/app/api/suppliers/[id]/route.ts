import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { supplierSchema } from '@/lib/inventory'
import { eq } from 'drizzle-orm'
import { BusinessError } from '@/lib/errors'
import { suppliers } from '@/server/db/schema'
import { supplierLedger } from '@/server/services/payment'
import { setSupplierStatus, toSupplier, updateSupplier } from '@/server/services/supplier'

type Ctx = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid('v.invalidId')

/** GET: the supplier with their account (ledger) built from purchases, returns and payments. */
export const GET = route<Ctx>(async (_req, { params }) => {
  await requireActor('purchases.manage')
  const db = await getDb()
  const id = idSchema.parse((await params).id)
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!row) throw new BusinessError('not_found', 'Supplier not found.', { key: 'supplierNotFound' })
  return json({ supplier: toSupplier(row), ledger: await supplierLedger(db, id) })
})

export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('purchases.manage')
  const input = await readBody(req, supplierSchema)
  return json(await updateSupplier(await getDb(), actor, idSchema.parse((await params).id), input))
})

/** PATCH: archive or restore. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('purchases.manage')
  const body = await readBody(req, z.object({ status: z.enum(['active', 'archived']) }))
  await setSupplierStatus(await getDb(), actor, idSchema.parse((await params).id), body.status)
  return json({ ok: true })
})
