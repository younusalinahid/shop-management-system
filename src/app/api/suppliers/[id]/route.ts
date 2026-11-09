import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { supplierSchema } from '@/lib/inventory'
import { setSupplierStatus, updateSupplier } from '@/server/services/supplier'

type Ctx = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid('v.invalidId')

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
