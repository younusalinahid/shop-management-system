import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { supplierSchema } from '@/lib/inventory'
import { createSupplier, listSuppliers } from '@/server/services/supplier'

export const GET = route(async () => {
  await requireActor('purchases.manage')
  return json({ items: await listSuppliers(await getDb()) })
})

export const POST = route(async (req) => {
  const actor = await requireActor('purchases.manage')
  const input = await readBody(req, supplierSchema)
  return json(await createSupplier(await getDb(), actor, input), { status: 201 })
})
