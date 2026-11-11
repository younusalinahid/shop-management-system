'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseBackup, Download, FileSpreadsheet, FolderClock, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { downloadText } from '@/lib/csv'
import { daysBetween, formatDateTime, todayDateOnly, toDateOnly } from '@/lib/datetime'
import { ApiError, errorMessage } from '@/lib/errors'

interface AutoStatus {
  enabled: boolean
  dir: string
  keep: number
  files: Array<{ name: string; size: number; createdAt: number }>
}

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

interface Inspection {
  exportedAt: number
  counts: Record<string, number>
}

/** Download a full backup, restore one (after an automatic safety backup), and CSV exports. */
export function BackupPage() {
  const t = useTranslations('backup')
  const tc = useTranslations('common')
  const settings = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; data: unknown; info: Inspection } | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const qc = useQueryClient()
  const auto = useQuery({ queryKey: ['backup-auto'], queryFn: () => api.get<AutoStatus>('/api/backup/auto') })
  const last = settings.lastBackupAt
  const overdue = !last || daysBetween(toDateOnly(last), todayDateOnly()) >= settings.autoBackupReminderDays

  /** Fetch a file from the API and save it with the name the server gives. */
  const save = async (url: string, fallback: string) => {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new ApiError(res.status, 'download_failed', t('downloadFailed'))
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback
    downloadText(name, await res.text(), res.headers.get('Content-Type') ?? 'application/octet-stream')
  }

  const backupNow = async () => {
    setBusy(true)
    try {
      await save('/api/backup', 'shop-backup.json')
      toast.success(t('backupToast'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const autoNow = async () => {
    setBusy(true)
    try {
      await api.post('/api/backup/auto', {})
      toast.success(t('autoSaved'))
      await Promise.all([qc.invalidateQueries({ queryKey: ['backup-auto'] }), qc.invalidateQueries({ queryKey: ['settings'] })])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const pick = async (f: File | undefined) => {
    setError(undefined)
    setFile(null)
    setConfirm('')
    if (!f) return
    try {
      const data = JSON.parse(await f.text()) as unknown
      const info = await api.post<Inspection>('/api/backup/inspect', data)
      setFile({ name: f.name, data, info })
    } catch (e) {
      setError(e instanceof SyntaxError ? t('notJson') : errorMessage(e))
    }
  }

  const restore = async () => {
    if (!file || confirm !== 'RESTORE') return
    setBusy(true)
    setError(undefined)
    try {
      // Safety first: keep a copy of what is there now.
      await save('/api/backup', 'shop-backup-before-restore.json')
      await api.post('/api/backup/restore', { confirm, backup: file.data })
      toast.success(t('restoredToast'))
      window.location.assign('/login')
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const exportUrl = (kind: string) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return kind === 'products' ? '/api/products/export' : `/api/export/${kind}?${p}`
  }

  return (
    <>
      <PageHeader icon={DatabaseBackup} title={t('title')} description={t('description')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-4 text-primary" /> {t('backupTitle')}
            </CardTitle>
            <CardDescription>{t('backupText')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className={overdue ? 'flex items-center gap-2 text-sm font-semibold text-warning-foreground dark:text-warning' : 'text-sm text-muted-foreground'}>
              {overdue && <AlertTriangle className="size-4" />}
              {last ? t('lastBackup', { date: formatDateTime(last) }) : t('neverBackedUp')}
            </p>
            <Button onClick={() => void backupNow()} disabled={busy} className="justify-self-start">
              <Download /> {t('downloadBackup')}
            </Button>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('storageNote')}</p>
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="size-4 text-destructive" /> {t('restoreTitle')}
            </CardTitle>
            <CardDescription>{t('restoreText')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="outline" className="justify-self-start" onClick={() => fileRef.current?.click()}>
              <Upload /> {t('chooseFile')}
            </Button>
            {file && (
              <div className="grid gap-3 rounded-lg border p-3 text-sm">
                <p>
                  <span className="font-semibold">{file.name}</span> · {t('madeAt', { date: formatDateTime(file.info.exportedAt) })}
                </p>
                <p className="text-muted-foreground">
                  {t('contains', { products: file.info.counts.products ?? 0, sales: file.info.counts.sales ?? 0, customers: file.info.counts.customers ?? 0, users: file.info.counts.users ?? 0 })}
                </p>
                <p className="flex items-start gap-2 font-semibold text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('warning')}
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="restore-confirm">{t('typeRestore')}</Label>
                  <Input id="restore-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" autoComplete="off" />
                </div>
                <Button variant="destructive" disabled={busy || confirm !== 'RESTORE'} onClick={() => void restore()}>
                  {busy ? tc('working') : t('restoreNow')}
                </Button>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderClock className="size-4 text-primary" /> {t('autoTitle')}
            </CardTitle>
            <CardDescription>{auto.data?.enabled === false ? t('autoOff') : t('autoText', { keep: auto.data?.keep ?? 30 })}</CardDescription>
          </CardHeader>
          {auto.data?.enabled && (
            <CardContent className="grid gap-3">
              <p className="text-sm">
                {t('autoFolder')} <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{auto.data.dir}</code>
              </p>
              {auto.data.files.length ? (
                <ul className="grid gap-1 text-sm">
                  {auto.data.files.slice(0, 5).map((f) => (
                    <li key={f.name} className="flex flex-wrap justify-between gap-x-4 rounded-md border px-3 py-1.5">
                      <span className="break-all font-medium">{f.name}</span>
                      <span className="text-muted-foreground">
                        {formatDateTime(f.createdAt)} · {sizeText(f.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('autoNone')}</p>
              )}
              <Button variant="outline" className="justify-self-start" onClick={() => void autoNow()} disabled={busy}>
                <FolderClock /> {t('autoNow')}
              </Button>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('autoTip')}</p>
            </CardContent>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-4 text-primary" /> {t('csvTitle')}
            </CardTitle>
            <CardDescription>{t('csvText')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('from')} />
            <span className="text-sm text-muted-foreground">–</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('to')} />
            {(['products', 'sales', 'purchases', 'customers', 'suppliers'] as const).map((k) => (
              <Button key={k} variant="outline" onClick={() => void save(exportUrl(k), `${k}.csv`).catch((e) => toast.error(errorMessage(e)))}>
                <Download /> {t(`csv.${k}`)}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
