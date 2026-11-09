import { z } from 'zod'
import type { Category, ID } from '@/types/db'

/** Category / brand form and API input. */
export const catalogEntrySchema = z.object({
  name: z.string().trim().min(1, 'v.nameRequired').max(80, 'v.nameTooLong'),
  description: z.string().trim().max(300).optional().default(''),
  parentId: z.string().uuid().optional(),
})
export type CatalogEntryInput = z.input<typeof catalogEntrySchema>

/** "Grocery › Rice" style path for a category, for pickers and tables. */
export function categoryPath(id: ID | undefined | null, byId: ReadonlyMap<ID, Category>): string {
  const names: string[] = []
  let cursor = id ? byId.get(id) : undefined
  for (let guard = 0; cursor && guard < 50; guard++) {
    names.unshift(cursor.name)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return names.join(' › ')
}
