import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { catalogEntrySchema } from '@/lib/catalog'
import { setCategoryStatus, updateCategory } from '@/server/services/catalog'

type Ctx = { params: Promise<{ id: string }> }

/** PUT: rename / edit. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('products.edit')
  const input = await readBody(req, catalogEntrySchema)
  return json(await updateCategory(await getDb(), actor, (await params).id, input))
})

/** PATCH: archive or restore. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireActor('products.edit')
  const { status } = await readBody(req, z.object({ status: z.enum(['active', 'archived']) }))
  await setCategoryStatus(await getDb(), actor, (await params).id, status)
  return json({ ok: true })
})
