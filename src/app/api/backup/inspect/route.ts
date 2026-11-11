import { json, requireActor, route } from '@/server/http'
import { BusinessError } from '@/lib/errors'
import { inspectBackup } from '@/server/services/backup'

/** POST: check a backup file and say what it contains, without changing anything. */
export const POST = route(async (req) => {
  await requireActor('backup.manage')
  const body = await req.json().catch(() => {
    throw new BusinessError('invalid', 'This is not a backup file.', { key: 'notBackup' })
  })
  return json(inspectBackup(body))
})
