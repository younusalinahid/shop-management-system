import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { generateBarcode } from '@/server/services/product'

/** POST { exclude?: string[] } → { code }: the next unused in-store EAN-13. */
export const POST = route(async (req) => {
  const actor = await requireActor('products.edit')
  const { exclude } = await readBody(req, z.object({ exclude: z.array(z.string().max(48)).max(100).default([]) }))
  return json({ code: await generateBarcode(await getDb(), actor, exclude) })
})
