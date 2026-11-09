import { z } from 'zod'
import { db } from '@/db/database'
import type { Brand, Category, ID, RecordStatus } from '@/types/db'
import { newId } from '@/lib/id'
import { type Actor, diffFields, writeAudit } from './audit-service'
import { BusinessError } from './errors'
import { requirePermission } from './permission-service'

/**
 * Categories and brands. Both are archived, never deleted, so products and historical
 * reports keep resolving their names.
 */

export const catalogEntrySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  description: z.string().trim().max(300).optional().default(''),
  parentId: z.string().optional(),
})
export type CatalogEntryInput = z.input<typeof catalogEntrySchema>

type Kind = 'category' | 'brand'

const table = (kind: Kind) => (kind === 'category' ? db.categories : db.brands)
const label = (kind: Kind) => (kind === 'category' ? 'Category' : 'Brand')

async function assertUniqueName(kind: Kind, name: string, exceptId?: ID) {
  const key = name.toLowerCase()
  const clash = await table(kind)
    .filter((r) => r.id !== exceptId && r.name.toLowerCase() === key)
    .first()
  if (clash) {
    const hint = clash.status === 'archived' ? ' (it is archived; restore it instead)' : ''
    throw new BusinessError('duplicate_name', `${label(kind)} "${clash.name}" already exists${hint}.`)
  }
}

/** A category cannot be its own ancestor. */
async function assertValidParent(id: ID | undefined, parentId: ID | undefined) {
  if (!parentId) return
  let cursor: ID | undefined = parentId
  for (let depth = 0; cursor; depth++) {
    if (cursor === id) throw new BusinessError('invalid_parent', 'A category cannot be placed inside itself.')
    if (depth > 50) throw new BusinessError('invalid_parent', 'Category nesting is too deep.')
    const parent: Category | undefined = await db.categories.get(cursor)
    if (!parent) throw new BusinessError('invalid_parent', 'The parent category no longer exists.')
    cursor = parent.parentId
  }
}

async function create(kind: Kind, actor: Actor, input: CatalogEntryInput): Promise<Category | Brand> {
  await requirePermission(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  const now = Date.now()
  const base = { id: newId(), name: data.name, description: data.description || undefined, status: 'active' as const, createdAt: now, updatedAt: now }
  const row = kind === 'category' ? { ...base, parentId: data.parentId || undefined } : base
  return db.transaction('rw', [table(kind), db.categories, db.auditLogs], async () => {
    await assertUniqueName(kind, data.name)
    if (kind === 'category') await assertValidParent(row.id, (row as Category).parentId)
    await table(kind).add(row)
    await writeAudit(actor, { action: `${kind}.create`, module: 'catalog', entityId: row.id, after: row })
    return row
  })
}

async function update(kind: Kind, actor: Actor, id: ID, input: CatalogEntryInput): Promise<Category | Brand> {
  await requirePermission(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  return db.transaction('rw', [table(kind), db.categories, db.auditLogs], async () => {
    const current = await table(kind).get(id)
    if (!current) throw new BusinessError('not_found', `${label(kind)} not found.`)
    await assertUniqueName(kind, data.name, id)
    const patch: Partial<Category> = { name: data.name, description: data.description || undefined }
    if (kind === 'category') {
      patch.parentId = data.parentId || undefined
      await assertValidParent(id, patch.parentId)
    }
    const { before, after, changed } = diffFields(current as Category, patch)
    if (!changed) return current
    const next = { ...current, ...patch, updatedAt: Date.now() }
    await table(kind).put(next)
    await writeAudit(actor, { action: `${kind}.update`, module: 'catalog', entityId: id, before, after })
    return next
  })
}

async function setStatus(kind: Kind, actor: Actor, id: ID, status: RecordStatus): Promise<void> {
  await requirePermission(actor, 'products.edit')
  await db.transaction('rw', [table(kind), db.auditLogs], async () => {
    const current = await table(kind).get(id)
    if (!current) throw new BusinessError('not_found', `${label(kind)} not found.`)
    if (current.status === status) return
    if (status === 'active') await assertUniqueName(kind, current.name, id)
    await table(kind).update(id, { status, updatedAt: Date.now() })
    await writeAudit(actor, {
      action: `${kind}.${status === 'archived' ? 'archive' : 'restore'}`,
      module: 'catalog',
      entityId: id,
      before: { status: current.status },
      after: { status },
    })
  })
}

export const createCategory = (actor: Actor, input: CatalogEntryInput) => create('category', actor, input) as Promise<Category>
export const updateCategory = (actor: Actor, id: ID, input: CatalogEntryInput) => update('category', actor, id, input) as Promise<Category>
export const setCategoryStatus = (actor: Actor, id: ID, status: RecordStatus) => setStatus('category', actor, id, status)

export const createBrand = (actor: Actor, input: CatalogEntryInput) => create('brand', actor, input) as Promise<Brand>
export const updateBrand = (actor: Actor, id: ID, input: CatalogEntryInput) => update('brand', actor, id, input) as Promise<Brand>
export const setBrandStatus = (actor: Actor, id: ID, status: RecordStatus) => setStatus('brand', actor, id, status)

/** "Grocery › Rice" style path for a category, for pickers and tables. */
export function categoryPath(id: ID | undefined, byId: ReadonlyMap<ID, Category>): string {
  const names: string[] = []
  let cursor = id ? byId.get(id) : undefined
  for (let guard = 0; cursor && guard < 50; guard++) {
    names.unshift(cursor.name)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return names.join(' › ')
}

/** Number of products (any status) using each category / brand id. */
export async function productCountsBy(field: 'categoryId' | 'brandId'): Promise<Map<ID, number>> {
  const counts = new Map<ID, number>()
  await db.products.each((p) => {
    const key = p[field]
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}
