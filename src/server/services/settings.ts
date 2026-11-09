import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppSettings } from '@/types/db'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import type { Db } from '../db'
import { settings } from '../db/schema'
import { type Actor, assertCan, diffFields, writeAudit } from './audit'

export async function getSettings(db: Db): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 'app'))
  return { ...DEFAULT_SETTINGS, ...(row?.data as Partial<AppSettings> | undefined), id: 'app', updatedAt: row?.updatedAt ?? 0 }
}

/** Fields an API client may change. Region fields (currency, timezone, …) are fixed for this release. */
export const settingsPatchSchema = z
  .object({
    shopName: z.string().trim().min(1, 'Shop name is required').max(100),
    shopPhone: z.string().trim().max(30),
    shopAddress: z.string().trim().max(200),
    logoDataUrl: z.string().startsWith('data:image/').max(600_000).optional(),
    invoicePrefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-/]+$/, 'Letters, numbers, - or / only'),
    purchasePrefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-/]+$/, 'Letters, numbers, - or / only'),
    invoiceFooter: z.string().trim().max(300),
    receiptWidthMm: z.union([z.literal(58), z.literal(80), z.literal(210)]),
    defaultTaxRate: z.number().int().min(0).max(10_000),
    pricesIncludeTax: z.boolean(),
    defaultPriceMode: z.enum(['retail', 'wholesale']),
    lowStockThreshold: z.number().int().min(0),
    expiryWarningDays: z.number().int().min(0).max(365),
    allowNegativeStock: z.boolean(),
    allowExpiredSale: z.boolean(),
    allowMultipleOpenShifts: z.boolean(),
    requireShiftForSale: z.boolean(),
    barcodeFormat: z.enum(['CODE128', 'EAN13']),
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export async function updateSettings(db: Db, actor: Actor, input: SettingsPatch): Promise<AppSettings> {
  assertCan(actor, 'settings.manage')
  const patch = settingsPatchSchema.parse(input)
  return db.transaction(async (tx) => {
    const current = await getSettings(tx)
    const { before, after, changed } = diffFields(current, patch)
    if (!changed) return current
    const now = Date.now()
    const { id: _id, updatedAt: _u, ...data } = { ...current, ...patch }
    await tx
      .insert(settings)
      .values({ id: 'app', data, updatedAt: now })
      .onConflictDoUpdate({ target: settings.id, set: { data, updatedAt: now } })
    // Never write the logo image into the audit log; it is large and not useful there.
    if ('logoDataUrl' in after) {
      before.logoDataUrl = before.logoDataUrl ? '[image]' : undefined
      after.logoDataUrl = after.logoDataUrl ? '[image]' : undefined
    }
    await writeAudit(tx, actor, { action: 'settings.update', module: 'settings', entityId: 'app', before, after })
    return { ...current, ...patch, updatedAt: now }
  })
}
