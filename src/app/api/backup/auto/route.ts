import { getDb } from '@/server/db'
import { json, requireActor, route } from '@/server/http'
import { autoBackupConfig, listAutoBackups, runAutoBackup } from '@/server/services/auto-backup'

/** GET: automatic backup settings and the files in the backup folder. */
export const GET = route(async () => {
  await requireActor('backup.manage')
  const config = autoBackupConfig()
  return json({ enabled: config.enabled, dir: config.dir, keep: config.keep, files: (await listAutoBackups(config)).slice(0, 10) })
})

/** POST: write a backup to the folder now. */
export const POST = route(async () => {
  await requireActor('backup.manage')
  return json(await runAutoBackup(await getDb(), { force: true }))
})
