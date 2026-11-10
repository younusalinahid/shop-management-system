'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, HandCoins, Pencil, Plus, Search, Truck, Users, WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Pagination, usePagination } from '@/components/shared/pagination'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRefreshData } from '@/hooks/use-catalog'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { type Party, PartyFormDialog, type PartyKind, PartyPaymentDialog, partyEndpoint } from './party-dialogs'

type Filter = 'active' | 'due' | 'archived' | 'all'

/**
 * Customers or suppliers. `dueOnly` turns it into the Customer Due / Supplier Due page: only parties with
 * a balance, largest first, with a collect/pay button.
 */
export function PartiesPage({ kind, dueOnly = false }: { kind: PartyKind; dueOnly?: boolean }) {
  const t = useTranslations('parties')
  const tk = useTranslations(`parties.${kind}`)
  const refresh = useRefreshData()
  const canEdit = usePermission('parties.edit')
  const canPay = usePermission(kind === 'customer' ? 'payments.manage' : 'purchases.manage')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(dueOnly ? 'due' : 'active')
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const [paying, setPaying] = useState<Party | null>(null)
  const list = useQuery({ queryKey: [kind === 'customer' ? 'customers' : 'suppliers'], queryFn: () => api.get<{ items: Party[] }>(partyEndpoint(kind)) })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list.data?.items ?? [])
      .filter((p) => (filter === 'all' ? true : filter === 'archived' ? p.status === 'archived' : filter === 'due' ? p.balance > 0 : p.status === 'active'))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q))
      .sort((a, b) => (filter === 'due' ? b.balance - a.balance : a.name.localeCompare(b.name)))
  }, [list.data, query, filter])
  const pager = usePagination(rows)
  const totalDue = (list.data?.items ?? []).reduce((s, p) => s + Math.max(0, p.balance), 0)
  const detailUrl = (id: string) => `/${kind === 'customer' ? 'customers' : 'suppliers'}/${id}`

  const toggle = async (p: Party) => {
    try {
      await api.patch(`${partyEndpoint(kind)}/${p.id}`, { status: p.status === 'active' ? 'archived' : 'active' })
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const Icon = dueOnly ? (kind === 'customer' ? HandCoins : WalletCards) : kind === 'customer' ? Users : Truck
  return (
    <>
      <PageHeader
        icon={Icon}
        title={dueOnly ? tk('dueTitle') : tk('title')}
        description={dueOnly ? tk('dueDescription', { amount: formatMoney(totalDue) }) : tk('description')}
        actions={
          canEdit &&
          !dueOnly && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> {tk('add')}
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
          </div>
          {!dueOnly && (
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList>
                <TabsTrigger value="active">{t('active')}</TabsTrigger>
                <TabsTrigger value="due">{tk('withDue')}</TabsTrigger>
                <TabsTrigger value="archived">{t('archived')}</TabsTrigger>
                <TabsTrigger value="all">{t('all')}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
        {list.isPending ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Icon} title={dueOnly ? tk('noDueTitle') : tk('emptyTitle')} description={dueOnly ? tk('noDueText') : tk('emptyText')} />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('phone')}</TableHead>
                  <TableHead className="text-right">{tk('balance')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={detailUrl(p.id)} className="font-semibold hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                      {p.status === 'archived' && (
                        <Badge variant="muted" className="ml-2">
                          {t('archived')}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground">{('companyName' in p && p.companyName) || p.address}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{p.phone ?? '—'}</TableCell>
                    <TableCell className={`text-right font-semibold whitespace-nowrap ${p.balance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{formatMoney(p.balance)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canPay && p.balance > 0 && (
                          <Button size="sm" variant="success" onClick={() => setPaying(p)}>
                            <HandCoins /> <span className="hidden sm:inline">{tk('payShort')}</span>
                          </Button>
                        )}
                        {canEdit && !dueOnly && (
                          <>
                            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(p)} aria-label={t('editNamed', { name: p.name })}>
                              <Pencil />
                            </Button>
                            <Button size="icon-sm" variant="ghost" onClick={() => void toggle(p)} aria-label={p.status === 'active' ? t('archiveNamed', { name: p.name }) : t('restoreNamed', { name: p.name })}>
                              {p.status === 'active' ? <Archive /> : <ArchiveRestore />}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination {...pager} />
          </>
        )}
      </Card>
      {editing && <PartyFormDialog kind={kind} party={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {paying && <PartyPaymentDialog kind={kind} party={paying} onClose={() => setPaying(null)} />}
    </>
  )
}
