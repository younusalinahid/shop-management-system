// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import { createInitialOwner } from '@/server/services/auth'
import { type AutoBackupConfig, autoBackupConfig, listAutoBackups, runAutoBackup } from '@/server/services/auto-backup'
import { inspectBackup } from '@/server/services/backup'

let dir: string
let config: AutoBackupConfig

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pos-auto-backup-'))
  config = { enabled: true, dir, keep: 3, intervalMs: 24 * 60 * 60 * 1000 }
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('automatic backup', () => {
  it('reads its settings from the environment', () => {
    expect(autoBackupConfig({}).enabled).toBe(true)
    expect(autoBackupConfig({ VERCEL: '1' }).enabled).toBe(false)
    expect(autoBackupConfig({ AUTO_BACKUP: 'off' }).enabled).toBe(false)
    expect(autoBackupConfig({ AUTO_BACKUP_DIR: dir, AUTO_BACKUP_KEEP: '7' })).toMatchObject({ dir: path.resolve(dir), keep: 7 })
    expect(autoBackupConfig({ AUTO_BACKUP_KEEP: 'x' }).keep).toBe(30)
  })

  it('does nothing before the shop is set up or when turned off', async () => {
    const db = await getDb()
    expect(await runAutoBackup(db, { config })).toEqual({ status: 'skipped', reason: 'no_shop' })
    expect(await runAutoBackup(db, { config: { ...config, enabled: false } })).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(await readdir(dir)).toEqual([])
  })

  it('writes a restorable backup once a day and keeps only the newest files', async () => {
    const db = await getDb()
    await createInitialOwner(db, { name: 'Karim', username: 'owner', pin: '2468' })

    const first = await runAutoBackup(db, { config })
    expect(first.status).toBe('written')
    if (first.status !== 'written') return
    expect(first.file.name).toMatch(/^shop-backup-auto-\d{8}-\d{4}\.json$/)
    const file = JSON.parse(await readFile(path.join(dir, first.file.name), 'utf8')) as unknown
    expect(inspectBackup(file).counts.users).toBe(1)

    // Not due again within a day, unless forced.
    expect(await runAutoBackup(db, { config })).toEqual({ status: 'skipped', reason: 'not_due' })
    for (let i = 0; i < 4; i++) expect((await runAutoBackup(db, { config, force: true })).status).toBe('written')

    const files = await listAutoBackups(config)
    expect(files).toHaveLength(3)
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
