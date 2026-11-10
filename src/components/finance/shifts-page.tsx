'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Clock, LogIn, LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { useSessionUser } from '@/hooks/use-session'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { ShiftRecord } from '@/lib/finance'
import type { Page } from '@/lib/inventory'
import { formatMoney, tryParseMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Open your shift with the drawer cash, close it with the counted cash; the app shows short or over. */
export function ShiftsPage() {
  const t = useTranslations('shifts')
  const me = useSessionUser()
  const canAll = usePermission('shifts.all')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<{ mode: 'open' } | { mode: 'close'; shift: ShiftRecord } | null>(null)
  const q = useQuery({
    queryKey: ['shifts', page],
    queryFn: () => api.get<Page<ShiftRecord> & { current: ShiftRecord | null }>(`/api/shifts?page=${page}`),
    placeholderData: keepPreviousData,
  })

  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const cur = q.data.current

  return (
    <>
      <PageHeader icon={Clock} title={t('title')} description={t('description')} />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t('yourShift')}</CardTitle>
        </CardHeader>
        <CardContent>
          {cur ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
                <Figure label={t('openedAt')} value={formatDateTime(cur.openedAt)} />
                <Figure label={t('opening')} value={formatMoney(cur.openingCash)} />
                <Figure label={t('sales', { count: cur.salesCount })} value={formatMoney(cur.salesTotal)} />
                <Figure label={t('expected')} value={formatMoney(cur.expectedCash)} strong />
              </div>
              <Button variant="destructive" onClick={() => setDialog({ mode: 'close', shift: cur })}>
                <LogOut /> {t('close')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t('noShift')}</p>
              <Button onClick={() => setDialog({ mode: 'open' })}>
                <LogIn /> {t('open')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">{canAll ? t('allShifts') : t('history')}</CardTitle>
        </CardHeader>
        {q.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Clock} title={t('emptyTitle')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('cashier')}</TableHead>
                  <TableHead>{t('time')}</TableHead>
                  <TableHead className="text-right">{t('expected')}</TableHead>
                  <TableHead className="text-right">{t('counted')}</TableHead>
                  <TableHead className="text-right">{t('difference')}</TableHead>
                  {canAll && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium">{s.userName}</p>
                      {s.status === 'open' ? <Badge variant="success">{t('openBadge')}</Badge> : <span className="text-xs text-muted-foreground">{t('salesShort', { count: s.salesCount, amount: formatMoney(s.salesTotal) })}</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateTime(s.openedAt)}
                      {s.closedAt && <p className="text-xs text-muted-foreground">→ {formatDateTime(s.closedAt)}</p>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatMoney(s.expectedCash)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{s.countedCash !== undefined ? formatMoney(s.countedCash) : '—'}</TableCell>
                    <TableCell className={cn('text-right font-semibold whitespace-nowrap', (s.difference ?? 0) < 0 && 'text-destructive', (s.difference ?? 0) > 0 && 'text-warning-foreground dark:text-warning')}>
                      {s.difference === undefined ? '—' : s.difference === 0 ? t('exact') : `${s.difference > 0 ? '+' : ''}${formatMoney(s.difference)}`}
                      {s.note && <p className="text-xs font-normal text-muted-foreground">{s.note}</p>}
                    </TableCell>
                    {canAll && (
                      <TableCell>
                        {s.status === 'open' && s.userId !== me.id && (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'close', shift: s })}>
                            {t('close')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ServerPager page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {dialog && <ShiftDialog state={dialog} onClose={() => setDialog(null)} onDone={() => void q.refetch()} />}
    </>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? 'text-lg font-bold text-primary' : 'font-semibold'}>{value}</p>
    </div>
  )
}

function ShiftDialog({ state, onClose, onDone }: { state: { mode: 'open' } | { mode: 'close'; shift: ShiftRecord }; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('shifts')
  const tc = useTranslations('common')
  const refresh = useRefreshData()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const value = tryParseMoney(amount || '0')
  const diff = state.mode === 'close' && value !== null ? value - state.shift.expectedCash : 0

  const submit = async () => {
    if (value === null) return setError(t('badAmount'))
    setBusy(true)
    try {
      if (state.mode === 'open') {
        await api.post('/api/shifts', { openingCash: value })
        toast.success(t('openedToast'))
      } else {
        const s = await api.post<ShiftRecord>(`/api/shifts/${state.shift.id}/close`, { countedCash: value, note })
        toast.success(s.difference === 0 ? t('closedExact') : t('closedDiff', { amount: formatMoney(s.difference ?? 0) }))
      }
      await refresh()
      onDone()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.mode === 'open' ? t('openTitle') : t('closeTitle', { name: state.shift.userName })}</DialogTitle>
          <DialogDescription>{state.mode === 'open' ? t('openText') : t('closeText', { amount: formatMoney(state.shift.expectedCash) })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="shift-amount">{state.mode === 'open' ? t('openingLabel') : t('countedLabel')}</Label>
            <Input id="shift-amount" inputMode="decimal" className="text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
          </div>
          {state.mode === 'close' && amount.trim() !== '' && value !== null && (
            <p className={cn('rounded-md px-3 py-2 text-sm font-semibold', diff === 0 ? 'bg-success/10 text-success' : diff < 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/20')}>
              {diff === 0 ? t('matches') : diff < 0 ? t('short', { amount: formatMoney(-diff) }) : t('over', { amount: formatMoney(diff) })}
            </p>
          )}
          {state.mode === 'close' && (
            <div className="grid gap-1.5">
              <Label htmlFor="shift-note">{t('note')}</Label>
              <Input id="shift-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant={state.mode === 'open' ? 'default' : 'destructive'} disabled={busy}>
              {busy ? tc('working') : state.mode === 'open' ? t('open') : t('close')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
