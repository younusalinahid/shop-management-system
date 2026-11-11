import { getDb } from '@/server/db'
import { requireActor, route } from '@/server/http'
import { exportBackup } from '@/server/services/backup'

/** GET: download the whole shop as one JSON backup file. */
export const GET = route(async () => {
  const actor = await requireActor('backup.manage')
  const backup = await exportBackup(await getDb(), actor)
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  return new Response(JSON.stringify(backup), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="shop-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  })
})
