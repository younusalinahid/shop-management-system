'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Pencil, Plus, Search, Tags } from 'lucide-react'
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
import { db } from '@/db/database'
import type { Brand, Category, ID } from '@/types/db'
import { usePermission } from '@/hooks/use-permission'
import { formatDate } from '@/lib/datetime'
import {
  catalogEntrySchema,
  categoryPath,
  createBrand,
  createCategory,
  productCountsBy,
  setBrandStatus,
  setCategoryStatus,
  updateBrand,
  updateCategory,
} from '@/services/catalog-service'
import { errorMessage } from '@/services/errors'
import { currentActor } from '@/stores/session-store'

type Kind = 'category' | 'brand'
type Entry = Category | Brand
type StatusFilter = 'active' | 'archived' | 'all'

const COPY: Record<Kind, { title: string; singular: string; description: string }> = {
  category: { title: 'Categories', singular: 'category', description: 'Group products for browsing, filtering and category-wise reports.' },
  brand: { title: 'Brands', singular: 'brand', description: 'Manufacturers and brands you stock.' },
}

export function CategoriesPage() {
  return <CatalogEntriesPage kind="category" />
}

export function BrandsPage() {
  return <CatalogEntriesPage kind="brand" />
}

function CatalogEntriesPage({ kind }: { kind: Kind }) {
  const copy = COPY[kind]
  const canEdit = usePermission('products.edit')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [editing, setEditing] = useState<Entry | 'new' | null>(null)

  const data = useLiveQuery(async () => {
    const [rows, categories, counts] = await Promise.all([
      kind === 'category' ? db.categories.toArray() : db.brands.toArray(),
      db.categories.toArray(),
      productCountsBy(kind === 'category' ? 'categoryId' : 'brandId'),
    ])
    return { rows: rows as Entry[], byId: new Map(categories.map((c) => [c.id, c])), counts }
  }, [kind])

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
      await (kind === 'category' ? setCategoryStatus : setBrandStatus)(currentActor(), row.id, next)
      toast.success(`${row.name} ${next === 'archived' ? 'archived' : 'restored'}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          canEdit && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Add {copy.singular}
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder={`Search ${copy.title.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
          </div>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {!data ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Tags}
              title={data.rows.length === 0 ? `No ${copy.title.toLowerCase()} yet` : 'Nothing matches'}
              description={data.rows.length === 0 ? `Add your first ${copy.singular} to start organising products.` : 'Try a different search or status filter.'}
              action={
                canEdit && data.rows.length === 0 ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus /> Add {copy.singular}
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
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="hidden sm:table-cell">Updated</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {row.label}
                        {row.status === 'archived' && <Badge variant="secondary">Archived</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-sm truncate text-muted-foreground md:table-cell">{row.description}</TableCell>
                    <TableCell className="text-right">{data.counts.get(row.id) ?? 0}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`}>
                            <Pencil />
                          </Button>
                          {row.status === 'active' ? (
                            <ConfirmDialog
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`Archive ${row.name}`}>
                                  <Archive />
                                </Button>
                              }
                              title={`Archive ${row.name}?`}
                              description={`It will be hidden from pickers. Products keep it, and you can restore it any time.${
                                data.counts.get(row.id) ? ` ${data.counts.get(row.id)} product(s) use it.` : ''
                              }`}
                              confirmLabel="Archive"
                              onConfirm={() => toggleStatus(row)}
                            />
                          ) : (
                            <Button variant="ghost" size="icon-sm" onClick={() => void toggleStatus(row)} aria-label={`Restore ${row.name}`}>
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
  const copy = COPY[kind]
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
      setError(parsed.error.issues[0].message)
      return
    }
    setBusy(true)
    try {
      const actor = currentActor()
      const input = { name, description, parentId: parentId || undefined }
      if (kind === 'category') await (entry ? updateCategory(actor, entry.id, input) : createCategory(actor, input))
      else await (entry ? updateBrand(actor, entry.id, input) : createBrand(actor, input))
      toast.success(entry ? 'Saved' : `${name.trim()} added`)
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
            <DialogTitle>{entry ? `Edit ${copy.singular}` : `Add ${copy.singular}`}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="entry-name">Name</Label>
            <Input id="entry-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          {kind === 'category' && (
            <div className="space-y-2">
              <Label>Parent category</Label>
              <Select value={parentId || 'none'} onValueChange={(v) => setParentId(v === 'none' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (top level)</SelectItem>
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
            <Label htmlFor="entry-desc">Description (optional)</Label>
            <Textarea id="entry-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
