import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { count, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { users } from '../db/schema'
import { SYSTEM_ACTOR } from './audit'
import { exportBackup } from './backup'

/**
 * Automatic backups to a folder on the computer that runs the app.
 *
 * - While the server runs, it checks every hour and writes a full backup once a day
 *   (`shop-backup-auto-YYYYMMDD-HHMM.json`), keeping the newest AUTO_BACKUP_KEEP files (default 30).
 * - Folder: AUTO_BACKUP_DIR, default `./backups` next to the app. Point it at another drive or a synced
 *   folder (OneDrive, Google Drive desktop) for an off-machine copy.
 * - Off on Vercel (its disk is temporary) and when AUTO_BACKUP=off.
 * - The files are the same format as a downloaded backup, so they restore from the Backup page.
 */

const PREFIX = 'shop-backup-auto-'
const DAY = 24 * 60 * 60 * 1000

export interface AutoBackupConfig {
  enabled: boolean
  dir: string
  keep: number
  intervalMs: number
}

export function autoBackupConfig(env: Record<string, string | undefined> = process.env): AutoBackupConfig {
  const keep = Number.parseInt(env.AUTO_BACKUP_KEEP ?? '', 10)
  return {
    enabled: !env.VERCEL && env.AUTO_BACKUP !== 'off',
    dir: path.resolve(/*turbopackIgnore: true*/ env.AUTO_BACKUP_DIR || 'backups'),
    keep: Number.isFinite(keep) && keep > 0 ? keep : 30,
    intervalMs: DAY,
  }
}

export interface AutoBackupFile {
  name: string
  size: number
  createdAt: number
}

/** Auto backup files in the folder, newest first. A missing folder is an empty list. */
export async function listAutoBackups(config = autoBackupConfig()): Promise<AutoBackupFile[]> {
  let names: string[]
  try {
    names = await readdir(/*turbopackIgnore: true*/ config.dir)
  } catch {
    return []
  }
  const files = await Promise.all(
    names
      .filter((n) => n.startsWith(PREFIX) && n.endsWith('.json'))
      .map(async (name) => {
        const s = await stat(/*turbopackIgnore: true*/ path.join(config.dir, name))
        return { name, size: s.size, createdAt: s.mtimeMs }
      }),
  )
  return files.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

export type AutoBackupResult = { status: 'written'; file: AutoBackupFile; removed: string[] } | { status: 'skipped'; reason: 'disabled' | 'not_due' | 'no_shop' }

/**
 * Write a backup if the newest one is a day old (or `force`). Writes to a temporary name first and
 * renames, so a crash never leaves a half-written file that looks like a backup.
 */
export async function runAutoBackup(db: Db, opts: { force?: boolean; now?: number; config?: AutoBackupConfig } = {}): Promise<AutoBackupResult> {
  const config = opts.config ?? autoBackupConfig()
  const now = opts.now ?? Date.now()
  if (!config.enabled) return { status: 'skipped', reason: 'disabled' }
  const [owners] = await db.select({ n: count() }).from(users).where(eq(users.role, 'owner'))
  if (!owners.n) return { status: 'skipped', reason: 'no_shop' }
  const existing = await listAutoBackups(config)
  if (!opts.force && existing[0] && now - existing[0].createdAt < config.intervalMs) return { status: 'skipped', reason: 'not_due' }

  const backup = await exportBackup(db, SYSTEM_ACTOR)
  await mkdir(/*turbopackIgnore: true*/ config.dir, { recursive: true })
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  let name = `${PREFIX}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  if (existing.some((f) => f.name === name)) name = name.replace('.json', `-${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}.json`)
  const target = path.join(/*turbopackIgnore: true*/ config.dir, name)
  const body = JSON.stringify(backup)
  await writeFile(/*turbopackIgnore: true*/ `${target}.tmp`, body, 'utf8')
  await rename(/*turbopackIgnore: true*/ `${target}.tmp`, target)

  const all = await listAutoBackups(config)
  const removed: string[] = []
  for (const old of all.slice(config.keep)) {
    await unlink(/*turbopackIgnore: true*/ path.join(config.dir, old.name)).catch(() => undefined)
    removed.push(old.name)
  }
  const s = await stat(target)
  return { status: 'written', file: { name, size: s.size, createdAt: s.mtimeMs }, removed }
}

const HOUR = 60 * 60 * 1000
const state = globalThis as unknown as { __posAutoBackup?: ReturnType<typeof setInterval> }

/** Start the hourly check once per server process (hot reloads reuse the same timer). */
export function startAutoBackupScheduler(getDb: () => Promise<Db>) {
  const config = autoBackupConfig()
  if (!config.enabled || state.__posAutoBackup) return
  const tick = async () => {
    try {
      const r = await runAutoBackup(await getDb(), { config })
      if (r.status === 'written') console.info(`[auto-backup] saved ${path.join(/*turbopackIgnore: true*/ config.dir, r.file.name)}`)
    } catch (e) {
      console.error('[auto-backup] failed:', e)
    }
  }
  state.__posAutoBackup = setInterval(() => void tick(), HOUR)
  state.__posAutoBackup.unref?.()
  // First check shortly after start, so the server is ready before a backup runs.
  setTimeout(() => void tick(), 60_000).unref?.()
  console.info(`[auto-backup] on: daily backups to ${config.dir} (keeping ${config.keep})`)
}
