import type { AppSettings } from '@/types/db'

/** Defaults for every setting. Stored settings are merged over these, so new settings always have a value. */
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
}
