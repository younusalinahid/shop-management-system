'use client'

import { Fragment, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ClipboardList, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { ServerPager } from '@/components/shared/server-pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import type { Page } from '@/lib/inventory'

interface AuditRecord {
  id: string
  userId: string
  userName: string
  action: string
  module: string
  entityId?: string
  before?: unknown
  after?: unknown
  reason?: string
  createdAt: number
}

const PAGE_SIZE = 50

/** Who did what and when, with the values before and after. Click a row for the details. */
export function AuditPage() {
  const t = useTranslations('audit')
  const [q, setQ] = useState('')
  const [module, setModule] = useState('all')
  const [userId, setUserId] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (q.trim()) params.set('q', q.trim())
  if (module !== 'all') params.set('module', module)
  if (userId !== 'all') params.set('userId', userId)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const list = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api.get<Page<AuditRecord> & { modules: string[]; users: Array<{ id: string; name: string }> }>(`/api/audit?${params}`),
    placeholderData: keepPreviousData,
  })
  const first = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader icon={ClipboardList} title={t('title')} description={t('description')} />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder={t('search')} value={q} onChange={(e) => first(setQ)(e.target.value)} aria-label={t('search')} />
          </div>
          <Select value={module} onValueChange={first(setModule)}>
            <SelectTrigger className="w-40" aria-label={t('module')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allModules')}</SelectItem>
              {(list.data?.modules ?? []).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userId} onValueChange={first(setUserId)}>
            <SelectTrigger className="w-40" aria-label={t('user')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allUsers')}</SelectItem>
              {(list.data?.users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" className="w-40" value={from} onChange={(e) => first(setFrom)(e.target.value)} aria-label={t('from')} />
          <span className="text-sm text-muted-foreground">–</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => first(setTo)(e.target.value)} aria-label={t('to')} />
        </div>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          </div>
        ) : list.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ClipboardList} title={t('emptyTitle')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-0" />
                  <TableHead>{t('time')}</TableHead>
                  <TableHead>{t('user')}</TableHead>
                  <TableHead>{t('action')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('reason')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((a) => (
                  <Fragment key={a.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                      <TableCell>{open === a.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatDateTime(a.createdAt)}</TableCell>
                      <TableCell className="font-medium">{a.userName}</TableCell>
                      <TableCell>
                        <Badge variant="muted" className="mr-1">
                          {a.module}
                        </Badge>
                        <span className="font-mono text-xs">{a.action}</span>
                      </TableCell>
                      <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground md:table-cell">{a.reason}</TableCell>
                    </TableRow>
                    {open === a.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <div className="grid gap-3 md:grid-cols-2">
                            {a.before !== undefined && <JsonBlock label={t('before')} value={a.before} />}
                            {a.after !== undefined && <JsonBlock label={t('after')} value={a.after} />}
                            {a.before === undefined && a.after === undefined && <p className="text-sm text-muted-foreground">{t('noDetails')}</p>}
                          </div>
                          {a.entityId && <p className="mt-2 font-mono text-xs text-muted-foreground">id: {a.entityId}</p>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <ServerPager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">{t('note')}</p>
    </>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-bold text-muted-foreground uppercase">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md border bg-card p-2 text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
