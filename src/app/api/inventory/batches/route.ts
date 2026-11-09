import { z } from 'zod'
import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { can } from '@/lib/permissions'
import { listBatches } from '@/server/services/inventory'
import { getSettings } from '@/server/services/settings'

const query = z.object({
  state: z.enum(['in_stock', 'expired', 'expiring', 'all']).default('in_stock'),
  productId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  days: z.coerce.number().int().min(0).max(365).optional(),
})

/** GET: batches with expiry, FEFO order. ?state=expired | expiring (within ?days, default the setting) | in_stock | all */
export const GET = route(async (req) => {
  const actor = await requireActor('inventory.view')
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''))
  const f = query.parse(params)
  const db = await getDb()
  const warningDays = f.days ?? (await getSettings(db)).expiryWarningDays
  const rows = await listBatches(db, { ...f, warningDays })
  const items = can(actor.role, 'products.view_cost') ? rows : rows.map((r) => ({ ...r, costTotal: 0, remainingValue: 0 }))
  return json({ items, warningDays })
})
