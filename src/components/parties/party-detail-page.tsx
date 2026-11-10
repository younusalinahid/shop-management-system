'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, HandCoins, Pencil, Truck, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { purchaseUrl, saleUrl } from '@/constants/navigation'
import { usePermission } from '@/hooks/use-permission'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import type { LedgerEntry } from '@/lib/parties'
import { type Party, PartyFormDialog, type PartyKind, PartyPaymentDialog, partyEndpoint } from './party-dialogs'

/** One customer or supplier: contact details, current balance, and the account history (ledger). */
export function PartyDetailPage({ kind, id }: { kind: PartyKind; id: string }) {
  const t = useTranslations('parties')
  const tk = useTranslations(`parties.${kind}`)
  const tl = useTranslations('ledger')
  const tm = useTranslations('paymentMethods')
  const canEdit = usePermission('parties.edit')
  const canPay = usePermission(kind === 'customer' ? 'payments.manage' : 'purchases.manage')
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const q = useQuery({
    queryKey: [kind, id],
    queryFn: () => api.get<{ customer?: Party; supplier?: Party; ledger: LedgerEntry[] }>(`${partyEndpoint(kind)}/${id}`),
  })

  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const party = (q.data.customer ?? q.data.supplier)!
  const ledger = [...q.data.ledger].reverse()
  const docUrl = (e: LedgerEntry) => (e.kind === 'sale' && e.refId ? saleUrl(e.refId) : e.kind === 'purchase' && e.refId ? purchaseUrl(e.refId) : undefined)

  return (
    <>
      <PageHeader
        icon={kind === 'customer' ? Users : Truck}
        title={party.name}
        description={[party.phone, 'companyName' in party ? party.companyName : undefined, party.address].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={kind === 'customer' ? '/customers' : '/suppliers'}>
                <ArrowLeft /> {tk('back')}
              </Link>
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> {t('edit')}
              </Button>
            )}
            {canPay && party.balance > 0 && (
              <Button variant="success" onClick={() => setPaying(true)}>
                <HandCoins /> {tk('payShort')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground">{tk('balance')}</p>
              <p className={`text-3xl font-bold ${party.balance > 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(party.balance)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{party.balance > 0 ? tk('owesHint') : t('settled')}</p>
            </CardContent>
          </Card>
          {party.notes && (
            <Card>
              <CardContent className="pt-6 text-sm whitespace-pre-wrap">{party.notes}</CardContent>
            </Card>
          )}
        </div>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">{tl('title')}</CardTitle>
          </CardHeader>
          {ledger.length === 0 ? (
            <div className="p-4">
              <EmptyState title={tl('emptyTitle')} description={tl('emptyText')} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tl('date')}</TableHead>
                  <TableHead>{tl('entry')}</TableHead>
                  <TableHead className="text-right">{tl('change')}</TableHead>
                  <TableHead className="text-right">{tl('balance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((e, i) => {
                  const url = docUrl(e)
                  return (
                    <TableRow key={`${e.refId ?? e.kind}-${i}`}>
                      <TableCell className="text-sm whitespace-nowrap">{formatDateTime(e.date)}</TableCell>
                      <TableCell>
                        <p className="font-medium">{tl(`kind.${e.kind}`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {url ? (
                            <Link href={url} className="text-primary hover:underline">
                              {e.ref}
                            </Link>
                          ) : (
                            e.ref
                          )}
                          {e.kind === 'payment' && e.description && ` · ${tm(e.description as never)}`}
                          {e.amount !== undefined && e.kind !== 'payment' && ` · ${tl('docTotal', { amount: formatMoney(e.amount) })}`}
                        </p>
                      </TableCell>
                      <TableCell className={`text-right font-semibold whitespace-nowrap ${e.change > 0 ? 'text-destructive' : 'text-success'}`}>
                        {e.change > 0 ? '+' : ''}
                        {formatMoney(e.change)}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">{formatMoney(e.balance)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      {editing && <PartyFormDialog kind={kind} party={party} onClose={() => setEditing(false)} onSaved={() => void q.refetch()} />}
      {paying && (
        <PartyPaymentDialog
          kind={kind}
          party={party}
          onClose={() => {
            setPaying(false)
            void q.refetch()
          }}
        />
      )}
    </>
  )
}
