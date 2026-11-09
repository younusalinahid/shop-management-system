import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { json, requireActor, route } from '@/server/http'
import { findByBarcode } from '@/server/services/product'

/** GET ?code=… → { product, unit? } for a scanned barcode, 404 when unknown. */
export const GET = route(async (req) => {
  await requireActor('products.view')
  const code = new URL(req.url).searchParams.get('code')?.trim()
  if (!code) throw new BusinessError('invalid', 'Missing barcode.')
  const hit = await findByBarcode(await getDb(), code)
  if (!hit) throw new BusinessError('not_found', 'No product has this barcode.')
  return json(hit)
})
