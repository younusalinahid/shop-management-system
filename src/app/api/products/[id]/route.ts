import { z } from 'zod'
import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import { productInputSchema } from '@/lib/product'
import { json, readBody, requireActor, route } from '@/server/http'
import { deleteProduct, getProductDetail, hideCost, setProductStatus, updateProduct } from '@/server/services/product'

type Ctx = { params: Promise<{ id: string }> }
const idSchema = z.string().uuid('Invalid product id')

export const GET = route<Ctx>(async (_req, { params }) => {
  const actor = await requireActor('products.view')
  const detail = await getProductDetail(await getDb(), idSchema.parse((await params).id))
  if (!detail) throw new BusinessError('not_found', 'Product not found.')
  return json(can(actor.role, 'products.view_cost') ? detail : hideCost(detail))
})

export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('products.edit')
  const input = await readBody(req, productInputSchema)
  return json(await updateProduct(await getDb(), actor, idSchema.parse((await params).id), input))
})

/** PATCH: archive or restore. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('products.edit')
  const body = await readBody(req, z.object({ status: z.enum(['active', 'archived']), reason: z.string().max(200).optional() }))
  await setProductStatus(await getDb(), actor, idSchema.parse((await params).id), body.status, body.reason)
  return json({ ok: true })
})

/** DELETE: only for products that were never stocked or used; others must be archived. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const actor = await requireActor('products.edit')
  await deleteProduct(await getDb(), actor, idSchema.parse((await params).id))
  return new Response(null, { status: 204 })
})
