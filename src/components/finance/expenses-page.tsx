'use client'

import { useId, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Ban, Plus, Wallet } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { formatDateOnly, todayDateOnly } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { EXPENSE_CATEGORIES, type ExpenseRecord } from '@/lib/finance'
import { newId } from '@/lib/id'
import type { Page } from '@/lib/inventory'
import { formatMoney, tryParseMoney } from '@/lib/money'
import { PAYMENT_METHODS } from '@/lib/sales'
import type { PaymentMethod } from '@/types/db'

const PAGE_SIZE = 25
const monthStart = () => `${todayDateOnly().slice(0, 8)}01`

/** Shop expenses with totals by category. Opens on this month. */
export function ExpensesPage() {
  const t = useTranslations('expenses')
  const tm = useTranslations('paymentMethods')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayDateOnly())
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<ExpenseRecord | null>(null)
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const list = useQuery({
    queryKey: ['expenses', params.toString()],
    queryFn: () => api.get<Page<ExpenseRecord> & { totals: { total: number; byCategory: Array<{ category: string; amount: number }> }; categories: string[] }>(`/api/expenses?${params}`),
    placeholderData: keepPreviousData,
  })
  const catLabel = useCategoryLabel()

  return (
    <>
      <PageHeader
        icon={Wallet}
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> {t('add')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <Input type="date" className="w-40" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label={t('from')} />
            <span className="text-sm text-muted-foreground">–</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label={t('to')} />
          </div>
          {list.isPending ? (
            <LoadingState />
          ) : list.isError ? (
            <div className="p-4">
              <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
            </div>
          ) : list.data.items.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Wallet} title={t('emptyTitle')} description={t('emptyText')} />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('date')}</TableHead>
                    <TableHead>{t('category')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('method')}</TableHead>
                    <TableHead className="text-right">{t('amount')}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.items.map((e) => (
                    <TableRow key={e.id} className={e.status === 'void' ? 'opacity-60' : undefined}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateOnly(e.expenseDate)}
                        <p className="text-xs text-muted-foreground">
                          {e.expenseNo} · {e.userName}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{catLabel(e.category)}</p>
                        {e.description && <p className="text-xs text-muted-foreground">{e.description}</p>}
                        {e.status === 'void' && <Badge variant="destructive">{t('void', { reason: e.voidReason ?? '' })}</Badge>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{tm(e.method)}</TableCell>
                      <TableCell className={`text-right font-semibold whitespace-nowrap ${e.status === 'void' ? 'line-through' : ''}`}>{formatMoney(e.amount)}</TableCell>
                      <TableCell>
                        {e.status === 'active' && (
                          <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setVoiding(e)} aria-label={t('voidNamed', { no: e.expenseNo })}>
                            <Ban />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ServerPager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
            </>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">{t('byCategory')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {(list.data?.totals.byCategory ?? []).map((c) => (
              <div key={c.category} className="flex justify-between gap-2">
                <span>{catLabel(c.category)}</span>
                <span className="font-semibold">{formatMoney(c.amount)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t pt-2 text-base">
              <span className="font-semibold">{t('total')}</span>
              <span className="font-bold text-destructive">{formatMoney(list.data?.totals.total ?? 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
      {adding && <ExpenseDialog categories={list.data?.categories ?? []} onClose={() => setAdding(false)} />}
      {voiding && <VoidExpenseDialog expense={voiding} onClose={() => setVoiding(null)} />}
    </>
  )
}

/** Built-in categories are translated; custom ones show as typed. */
function useCategoryLabel() {
  const t = useTranslations('expenses.categories')
  return (c: string) => ((EXPENSE_CATEGORIES as readonly string[]).includes(c) ? t(c) : c)
}

function ExpenseDialog({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const t = useTranslations('expenses')
  const tm = useTranslations('paymentMethods')
  const tc = useTranslations('common')
  const ids = useId()
  const refresh = useRefreshData()
  const catLabel = useCategoryLabel()
  const key = useRef(newId())
  const options = [...new Set([...EXPENSE_CATEGORIES, ...categories])]
  const [category, setCategory] = useState<string>('rent')
  const [custom, setCustom] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [date, setDate] = useState(todayDateOnly())
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    setError(undefined)
    const value = tryParseMoney(amount)
    if (value === null || value <= 0) return setError(t('badAmount'))
    const cat = category === '__new' ? custom.trim() : category
    if (!cat) return setError(t('categoryRequired'))
    setBusy(true)
    try {
      await api.post('/api/expenses', { idempotencyKey: key.current, category: cat, amount: value, method, expenseDate: date, description })
      await refresh()
      toast.success(t('savedToast', { amount: formatMoney(value) }))
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
          <DialogTitle>{t('newTitle')}</DialogTitle>
          <DialogDescription>{t('newText')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-cat`}>{t('category')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id={`${ids}-cat`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((c) => (
                    <SelectItem key={c} value={c}>
                      {catLabel(c)}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new">{t('newCategory')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-amount`}>{t('amount')}</Label>
              <Input id={`${ids}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </div>
          {category === '__new' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-custom`}>{t('categoryName')}</Label>
              <Input id={`${ids}-custom`} value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-method`}>{t('method')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id={`${ids}-method`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tm(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-date`}>{t('date')}</Label>
              <Input id={`${ids}-date`} type="date" value={date} max={todayDateOnly()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-desc`}>{t('descriptionLabel')}</Label>
            <Input id={`${ids}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tc('working') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VoidExpenseDialog({ expense, onClose }: { expense: ExpenseRecord; onClose: () => void }) {
  const t = useTranslations('expenses')
  const tc = useTranslations('common')
  const refresh = useRefreshData()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async () => {
    if (!reason.trim()) return setError(t('reasonRequired'))
    setBusy(true)
    try {
      await api.post(`/api/expenses/${expense.id}/void`, { reason })
      await refresh()
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
          <DialogTitle>{t('voidTitle', { no: expense.expenseNo })}</DialogTitle>
          <DialogDescription>{t('voidText')}</DialogDescription>
        </DialogHeader>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} aria-label={t('reasonPlaceholder')} autoFocus />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? tc('working') : t('confirmVoid')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
