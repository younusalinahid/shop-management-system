import { getDb } from '@/server/db'
import { BusinessError } from '@/lib/errors'
import { json, requireActor, route } from '@/server/http'
import { restoreBackup } from '@/server/services/backup'

/**
 * POST { confirm: "RESTORE", backup: <file> }: replace all data with the backup. Everyone, including the
 * person restoring, is signed out afterwards.
 */
export const POST = route(async (req) => {
  const actor = await requireActor('backup.manage')
  const body = (await req.json().catch(() => null)) as { confirm?: string; backup?: unknown } | null
  if (!body || body.confirm !== 'RESTORE') throw new BusinessError('invalid', 'Type RESTORE to confirm.', { key: 'restoreConfirm' })
  return json(await restoreBackup(await getDb(), actor, body.backup))
})
