import { db, SCHEMA_VERSION } from '@/db/database'
import type { AppSettings } from '@/types/db'
import { type Actor, diffFields, writeAudit } from './audit-service'

export const DEFAULT_SETTINGS: Omit<AppSettings, 'updatedAt'> = {
  id: 'app',
  shopName: 'My Shop',
  shopAddress: '',
  shopPhone: '',
  currency: 'BDT',
  currencySymbol: '৳',
  locale: 'en-IN',
  timezone: 'Asia/Dhaka',
  dateFormat: 'DD/MM/YYYY',
  invoicePrefix: 'INV-',
  purchasePrefix: 'PUR-',
  invoiceFooter: 'Thank you for shopping with us!',
  defaultTaxRate: 0,
  pricesIncludeTax: true,
  defaultPriceMode: 'retail',
  lowStockThreshold: 0,
  expiryWarningDays: 30,
  allowNegativeStock: false,
  allowExpiredSale: false,
  allowMultipleOpenShifts: false,
  requireShiftForSale: false,
  receiptWidthMm: 80,
  barcodeFormat: 'CODE128',
  autoBackupReminderDays: 7,
  schemaVersion: SCHEMA_VERSION,
}

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get('app')
  // Merge with defaults so settings added in later versions always have a value.
  return { ...DEFAULT_SETTINGS, updatedAt: 0, ...s }
}

export type SettingsPatch = Partial<Omit<AppSettings, 'id' | 'updatedAt' | 'schemaVersion'>>

export async function updateSettings(actor: Actor, patch: SettingsPatch): Promise<AppSettings> {
  return db.transaction('rw', db.settings, db.auditLogs, async () => {
    const current = await getSettings()
    const { before, after, changed } = diffFields(current, patch)
    if (!changed) return current
    const next: AppSettings = { ...current, ...patch, updatedAt: Date.now() }
    await db.settings.put(next)
    // Never write the logo image into the audit log; it is large and not useful there.
    if ('logoDataUrl' in after) {
      before.logoDataUrl = before.logoDataUrl ? '[image]' : undefined
      after.logoDataUrl = after.logoDataUrl ? '[image]' : undefined
    }
    await writeAudit(actor, { action: 'settings.update', module: 'settings', entityId: 'app', before, after })
    return next
  })
}
