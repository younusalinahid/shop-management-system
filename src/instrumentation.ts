/** Runs once when the server starts. Starts the daily automatic backup (Node.js runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [{ getDb }, { startAutoBackupScheduler }] = await Promise.all([import('./server/db'), import('./server/services/auto-backup')])
  startAutoBackupScheduler(getDb)
}
