import { z } from 'zod'
import { getDb } from '@/server/db'
import { requireActor, route } from '@/server/http'
import { todayDateOnly } from '@/lib/datetime'
import { exportProductsCsv } from '@/server/services/product-csv'

/** GET /api/products/export[?ids=a,b] → CSV download. */
export const GET = route(async (req) => {
  const actor = await requireActor('products.view')
  const raw = new URL(req.url).searchParams.get('ids')
  const productIds = raw ? z.array(z.string().uuid()).max(5000).parse(raw.split(',')) : undefined
  const csv = await exportProductsCsv(await getDb(), actor, { productIds })
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="products-${todayDateOnly()}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
})
