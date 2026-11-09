'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Archive, ArchiveRestore, Award, Pencil, Plus, Search, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { PageHeader } from '@/components/shared/page-header'
import { Pagination, usePagination } from '@/components/shared/pagination'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Brand, Category, ID } from '@/types/db'
import { usePermission } from '@/hooks/use-permission'
import { formatDate } from '@/lib/datetime'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { catalogEntrySchema, categoryPath } from '@/lib/catalog'
import { errorMessage } from '@/lib/errors'
import { translateMessage } from '@/i18n/translate'

interface ListResponse<T> {
  items: T[]
  productCounts: Record<ID, number>
}
const endpoint = (kind: 'category' | 'brand') => (kind === 'category' ? '/api/categories' : '/api/brands')

type Kind = 'category' | 'brand'
type Entry = Category | Brand
type StatusFilter = 'active' | 'archived' | 'all'


export function CategoriesPage() {
  return <CatalogEntriesPage kind="category" />
}

export function BrandsPage() {
  return <CatalogEntriesPage kind="brand" />
}

function CatalogEntriesPage({ kind }: { kind: Kind }) {
  const t = useTranslations('catalog')
  const tk = useTranslations(`catalog.${kind}`)
  const canEdit = usePermission('products.edit')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [editing, setEditing] = useState<Entry | 'new' | null>(null)

  const refresh = useRefreshData()
  const list = useQuery({ queryKey: [kind], queryFn: () => api.get<ListResponse<Entry>>(endpoint(kind)) })
  // Category names are needed for "Parent › Child" labels and the parent picker.
  const cats = useQuery({ queryKey: ['category'], queryFn: () => api.get<ListResponse<Category>>('/api/categories'), enabled: kind === 'category' })
  const data = useMemo(() => {
    if (!list.data || (kind === 'category' && !cats.data)) return undefined
    const categories = cats.data?.items ?? []
    return { rows: list.data.items, byId: new Map(categories.map((c) => [c.id, c])), counts: list.data.productCounts }
  }, [list.data, cats.data, kind])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.rows
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
      .map((r) => ({ ...r, label: kind === 'category' ? categoryPath(r.id, data.byId) : r.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [data, query, status, kind])
  const pager = usePagination(filtered)

  const toggleStatus = async (row: Entry) => {
    const next = row.status === 'active' ? 'archived' : 'active'
    try {
      await api.patch(`${endpoint(kind)}/${row.id}`, { status: next })
      await refresh()
      toast.success(next === 'archived' ? t('archivedToast', { name: row.name }) : t('restoredToast', { name: row.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        icon={kind === 'category' ? Tags : Award}
        title={tk('title')}
        description={tk('description')}
        actions={
          canEdit && (
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
            <Input className="pl-8" placeholder={tk('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
          </div>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="active">{t('active')}</TabsTrigger>
              <TabsTrigger value="archived">{t('archived')}</TabsTrigger>
              <TabsTrigger value="all">{t('all')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {!data ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Tags}
              title={data.rows.length === 0 ? tk('emptyTitle') : t('nothingMatches')}
              description={data.rows.length === 0 ? tk('emptyText') : t('tryDifferent')}
              action={
                canEdit && data.rows.length === 0 ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus /> {tk('add')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('description')}</TableHead>
                  <TableHead className="text-right">{t('products')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('updated')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {row.label}
                        {row.status === 'archived' && <Badge variant="muted">{t('archived')}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-sm truncate text-muted-foreground md:table-cell">{row.description}</TableCell>
                    <TableCell className="text-right">{data.counts[row.id] ?? 0}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(row)} aria-label={t('editNamed', { name: row.name })}>
                            <Pencil />
                          </Button>
                          {row.status === 'active' ? (
                            <ConfirmDialog
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={t('archiveNamed', { name: row.name })}>
                                  <Archive />
                                </Button>
                              }
                              title={t('archiveConfirmTitle', { name: row.name })}
                              description={`${t('archiveConfirmText')}${data.counts[row.id] ? ` ${t('productsUsing', { count: data.counts[row.id] })}` : ''}`}
                              confirmLabel={t('archive')}
                              onConfirm={() => toggleStatus(row)}
                            />
                          ) : (
                            <Button variant="ghost" size="icon-sm" onClick={() => void toggleStatus(row)} aria-label={t('restoreNamed', { name: row.name })}>
                              <ArchiveRestore />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination {...pager} />
          </>
        )}
      </Card>
      {editing && data && (
        <EntryDialog
          kind={kind}
          entry={editing === 'new' ? null : editing}
          categories={[...data.byId.values()]}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function EntryDialog({ kind, entry, categories, onClose }: { kind: Kind; entry: Entry | null; categories: Category[]; onClose: () => void }) {
  const t = useTranslations('catalog')
  const tk = useTranslations(`catalog.${kind}`)
  const tAll = useTranslations()
  const refresh = useRefreshData()
  const [name, setName] = useState(entry?.name ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [parentId, setParentId] = useState<ID | ''>((entry as Category | null)?.parentId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setError(null), [name])

  const byId = new Map(categories.map((c) => [c.id, c]))
  // A category cannot move under itself or one of its descendants (the service rejects it too).
  const isSelfOrDescendant = (id: ID) => {
    for (let c = byId.get(id), guard = 0; c && guard < 50; c = c.parentId ? byId.get(c.parentId) : undefined, guard++) {
      if (c.id === entry?.id) return true
    }
    return false
  }
  const parentOptions = categories
    .filter((c) => c.status === 'active' && !isSelfOrDescendant(c.id))
    .map((c) => ({ id: c.id, label: categoryPath(c.id, byId) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = catalogEntrySchema.safeParse({ name, description, parentId: parentId || undefined })
    if (!parsed.success) {
      setError(translateMessage(tAll, parsed.error.issues[0].message))
      return
    }
    setBusy(true)
    try {
      const input = { name, description, ...(kind === 'category' && parentId ? { parentId } : {}) }
      if (entry) await api.put(`${endpoint(kind)}/${entry.id}`, input)
      else await api.post(endpoint(kind), input)
      await refresh()
      toast.success(entry ? t('saved') : t('added', { name: name.trim() }))
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{entry ? tk('edit') : tk('add')}</DialogTitle>
            <DialogDescription>{tk('description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="entry-name">{t('name')}</Label>
            <Input id="entry-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          {kind === 'category' && (
            <div className="space-y-2">
              <Label>{t('parentCategory')}</Label>
              <Select value={parentId || 'none'} onValueChange={(v) => setParentId(v === 'none' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('topLevel')}</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="entry-desc">{t('descriptionOptional')}</Label>
            <Textarea id="entry-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
