import { and, asc, count, eq, isNotNull, ne, sql } from 'drizzle-orm'
import type { Brand, Category, ID, RecordStatus } from '@/types/db'
import { catalogEntrySchema, type CatalogEntryInput } from '@/lib/catalog'
import { BusinessError } from '@/lib/errors'
import type { Db } from '../db'
import { brands, categories, products } from '../db/schema'
import { type Actor, assertCan, diffFields, writeAudit } from './audit'

/**
 * Categories and brands. Both are archived, never deleted, so products and historical
 * reports keep resolving their names. Names are unique ignoring case (enforced by a DB index too).
 */

type Kind = 'category' | 'brand'
const label = (kind: Kind) => (kind === 'category' ? 'Category' : 'Brand')

async function assertUniqueName(db: Db, kind: Kind, name: string, exceptId?: ID) {
  const t = kind === 'category' ? categories : brands
  const where = exceptId ? and(eq(sql`lower(${t.name})`, name.toLowerCase()), ne(t.id, exceptId)) : eq(sql`lower(${t.name})`, name.toLowerCase())
  const [clash] = await db.select({ name: t.name, status: t.status }).from(t).where(where)
  if (clash) {
    const hint = clash.status === 'archived' ? ' (it is archived; restore it instead)' : ''
    throw new BusinessError('duplicate_name', `${label(kind)} "${clash.name}" already exists${hint}.`, {
      key: kind === 'category' ? 'duplicateCategory' : 'duplicateBrand',
      values: { name: clash.name, archived: clash.status === 'archived' ? 'yes' : 'no' },
    })
  }
}

/** A category cannot be its own ancestor. */
async function assertValidParent(db: Db, id: ID | undefined, parentId: ID | undefined) {
  if (!parentId) return
  let cursor: ID | null | undefined = parentId
  for (let depth = 0; cursor; depth++) {
    if (cursor === id) throw new BusinessError('invalid_parent', 'A category cannot be placed inside itself.', { key: 'parentSelf' })
    if (depth > 50) throw new BusinessError('invalid_parent', 'Category nesting is too deep.', { key: 'parentTooDeep' })
    const [parent]: Array<{ parentId: string | null }> = await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, cursor))
    if (!parent) throw new BusinessError('invalid_parent', 'The parent category no longer exists.', { key: 'parentMissing' })
    cursor = parent.parentId
  }
}

const toCategory = (r: typeof categories.$inferSelect): Category => ({ ...r, parentId: r.parentId ?? undefined, description: r.description ?? undefined })
const toBrand = (r: typeof brands.$inferSelect): Brand => ({ ...r, description: r.description ?? undefined })

// ---------------------------------------------------------------- categories

export async function listCategories(db: Db): Promise<Category[]> {
  return (await db.select().from(categories).orderBy(asc(categories.name))).map(toCategory)
}

export async function createCategory(db: Db, actor: Actor, input: CatalogEntryInput): Promise<Category> {
  assertCan(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  const now = Date.now()
  return db.transaction(async (tx) => {
    await assertUniqueName(tx, 'category', data.name)
    await assertValidParent(tx, undefined, data.parentId)
    const [row] = await tx
      .insert(categories)
      .values({ name: data.name, description: data.description || null, parentId: data.parentId ?? null, status: 'active', createdAt: now, updatedAt: now })
      .returning()
    await writeAudit(tx, actor, { action: 'category.create', module: 'catalog', entityId: row.id, after: row })
    return toCategory(row)
  })
}

export async function updateCategory(db: Db, actor: Actor, id: ID, input: CatalogEntryInput): Promise<Category> {
  assertCan(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(categories).where(eq(categories.id, id))
    if (!current) throw new BusinessError('not_found', 'Category not found.', { key: 'categoryNotFound' })
    await assertUniqueName(tx, 'category', data.name, id)
    await assertValidParent(tx, id, data.parentId)
    const patch = { name: data.name, description: data.description || null, parentId: data.parentId ?? null }
    const { before, after, changed } = diffFields(current, patch)
    if (!changed) return toCategory(current)
    const [row] = await tx.update(categories).set({ ...patch, updatedAt: Date.now() }).where(eq(categories.id, id)).returning()
    await writeAudit(tx, actor, { action: 'category.update', module: 'catalog', entityId: id, before, after })
    return toCategory(row)
  })
}

export async function setCategoryStatus(db: Db, actor: Actor, id: ID, status: RecordStatus): Promise<void> {
  assertCan(actor, 'products.edit')
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(categories).where(eq(categories.id, id))
    if (!current) throw new BusinessError('not_found', 'Category not found.', { key: 'categoryNotFound' })
    if (current.status === status) return
    await tx.update(categories).set({ status, updatedAt: Date.now() }).where(eq(categories.id, id))
    await writeAudit(tx, actor, {
      action: `category.${status === 'archived' ? 'archive' : 'restore'}`,
      module: 'catalog',
      entityId: id,
      before: { status: current.status },
      after: { status },
    })
  })
}

// ---------------------------------------------------------------- brands

export async function listBrands(db: Db): Promise<Brand[]> {
  return (await db.select().from(brands).orderBy(asc(brands.name))).map(toBrand)
}

export async function createBrand(db: Db, actor: Actor, input: CatalogEntryInput): Promise<Brand> {
  assertCan(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  const now = Date.now()
  return db.transaction(async (tx) => {
    await assertUniqueName(tx, 'brand', data.name)
    const [row] = await tx.insert(brands).values({ name: data.name, description: data.description || null, status: 'active', createdAt: now, updatedAt: now }).returning()
    await writeAudit(tx, actor, { action: 'brand.create', module: 'catalog', entityId: row.id, after: row })
    return toBrand(row)
  })
}

export async function updateBrand(db: Db, actor: Actor, id: ID, input: CatalogEntryInput): Promise<Brand> {
  assertCan(actor, 'products.edit')
  const data = catalogEntrySchema.parse(input)
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(brands).where(eq(brands.id, id))
    if (!current) throw new BusinessError('not_found', 'Brand not found.', { key: 'brandNotFound' })
    await assertUniqueName(tx, 'brand', data.name, id)
    const patch = { name: data.name, description: data.description || null }
    const { before, after, changed } = diffFields(current, patch)
    if (!changed) return toBrand(current)
    const [row] = await tx.update(brands).set({ ...patch, updatedAt: Date.now() }).where(eq(brands.id, id)).returning()
    await writeAudit(tx, actor, { action: 'brand.update', module: 'catalog', entityId: id, before, after })
    return toBrand(row)
  })
}

export async function setBrandStatus(db: Db, actor: Actor, id: ID, status: RecordStatus): Promise<void> {
  assertCan(actor, 'products.edit')
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(brands).where(eq(brands.id, id))
    if (!current) throw new BusinessError('not_found', 'Brand not found.', { key: 'brandNotFound' })
    if (current.status === status) return
    await tx.update(brands).set({ status, updatedAt: Date.now() }).where(eq(brands.id, id))
    await writeAudit(tx, actor, {
      action: `brand.${status === 'archived' ? 'archive' : 'restore'}`,
      module: 'catalog',
      entityId: id,
      before: { status: current.status },
      after: { status },
    })
  })
}

/** Number of products (any status) using each category or brand. */
export async function productCountsBy(db: Db, field: 'categoryId' | 'brandId'): Promise<Record<ID, number>> {
  const col = field === 'categoryId' ? products.categoryId : products.brandId
  const rows = await db.select({ key: col, n: count() }).from(products).where(isNotNull(col)).groupBy(col)
  return Object.fromEntries(rows.map((r) => [r.key as string, r.n]))
}
