import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { parseProductCsv } from '@/lib/product-csv'
import { getServerT } from '@/server/i18n'
import { importProducts } from '@/server/services/product-csv'

/**
 * POST { csv } → validates the whole file; on any error responds 400 with every row problem and
 * writes nothing. Otherwise imports all new products in one transaction.
 */
export const POST = route(async (req) => {
  const actor = await requireActor('products.edit', 'products.edit_price')
  const { csv } = await readBody(req, z.object({ csv: z.string().max(5 * 1024 * 1024, 'v.fileTooLarge') }))
  const parsed = parseProductCsv(csv)
  if (parsed.errors.length) {
    return json(
      { error: { code: 'invalid_csv', message: (await getServerT())('errors.csvProblems', { count: parsed.errors.length }), issues: parsed.errors } },
      { status: 400 },
    )
  }
  return json(await importProducts(await getDb(), actor, parsed))
})
