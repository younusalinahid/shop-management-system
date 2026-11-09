'use client'

import { useTranslations } from 'next-intl'
import { PrintPortal, printNow } from '@/components/shared/print-portal'
import { BarcodeSvg } from '@/components/shared/barcode-svg'
import type { AppSettings } from '@/types/db'
import { formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import type { SaleDetail } from '@/lib/sales'
import { formatQtyNumber } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * Customer receipt. Thermal width (58/80 mm) or A4 from settings. Shown on screen as a preview and
 * printed through PrintPortal, so only the receipt reaches the printer.
 */
export function Receipt({ sale, settings, className }: { sale: SaleDetail; settings: AppSettings; className?: string }) {
  const t = useTranslations('receipt')
  const tm = useTranslations('paymentMethods')
  const width = settings.receiptWidthMm
  const row = 'flex justify-between gap-2'
  return (
    <div className={cn('mx-auto bg-white font-mono text-[12px] leading-snug text-black', width === 210 ? 'max-w-[180mm] p-6 text-sm' : 'p-2', className)} style={width === 210 ? undefined : { width: `${width - 4}mm` }}>
      <div className="text-center">
        {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="" className="mx-auto mb-1 max-h-12" />}
        <p className="text-[15px] font-bold">{settings.shopName}</p>
        {settings.shopAddress && <p>{settings.shopAddress}</p>}
        {settings.shopPhone && <p>{t('phone', { phone: settings.shopPhone })}</p>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className={row}>
        <span>{t('invoice')}</span>
        <span className="font-bold">{sale.invoiceNo}</span>
      </div>
      <div className={row}>
        <span>{t('date')}</span>
        <span>{formatDateTime(sale.createdAt)}</span>
      </div>
      <div className={row}>
        <span>{t('cashier')}</span>
        <span>{sale.cashierName}</span>
      </div>
      {sale.customerName && (
        <div className={row}>
          <span>{t('customer')}</span>
          <span className="text-right">
            {sale.customerName}
            {sale.customerPhone && ` · ${sale.customerPhone}`}
          </span>
        </div>
      )}
      {sale.status === 'cancelled' && <p className="mt-1 text-center font-bold">*** {t('cancelled')} ***</p>}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.items.map((it) => (
        <div key={it.id} className="mb-1">
          <p className="font-semibold">{it.productName}</p>
          <div className={row}>
            <span>
              {formatQtyNumber(it.quantity)} {it.unitName} × {formatMoney(it.unitPrice, { symbol: false })}
            </span>
            <span>{formatMoney(it.amount, { symbol: false })}</span>
          </div>
          {it.discount > 0 && (
            <div className={row}>
              <span>{t('lineDiscount')}</span>
              <span>−{formatMoney(it.discount, { symbol: false })}</span>
            </div>
          )}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      <div className={row}>
        <span>{t('subtotal')}</span>
        <span>{formatMoney(sale.subtotal)}</span>
      </div>
      {sale.itemDiscountTotal + sale.invoiceDiscount > 0 && (
        <div className={row}>
          <span>{t('discount')}</span>
          <span>−{formatMoney(sale.itemDiscountTotal + sale.invoiceDiscount)}</span>
        </div>
      )}
      {sale.taxTotal > 0 && (
        <div className={row}>
          <span>{settings.pricesIncludeTax ? t('vatIncluded') : t('vat')}</span>
          <span>{formatMoney(sale.taxTotal)}</span>
        </div>
      )}
      <div className={cn(row, 'mt-1 text-[15px] font-bold')}>
        <span>{t('total')}</span>
        <span>{formatMoney(sale.total)}</span>
      </div>
      {sale.payments.map((p) => (
        <div key={p.id} className={row}>
          <span>
            {tm(p.method)}
            {p.reference && ` (${p.reference})`}
          </span>
          <span>{formatMoney(p.tendered)}</span>
        </div>
      ))}
      {sale.changeGiven > 0 && (
        <div className={row}>
          <span>{t('change')}</span>
          <span>{formatMoney(sale.changeGiven)}</span>
        </div>
      )}
      {sale.due > 0 && (
        <div className={cn(row, 'font-bold')}>
          <span>{t('due')}</span>
          <span>{formatMoney(sale.due)}</span>
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-center">
        <BarcodeSvg value={sale.invoiceNo} format="CODE128" height={30} className="w-[85%]" />
      </div>
      {settings.invoiceFooter && <p className="mt-1 text-center">{settings.invoiceFooter}</p>}
    </div>
  )
}

/** Print a receipt now (mounts it in the print portal first). */
export function PrintableReceipt({ sale, settings }: { sale: SaleDetail; settings: AppSettings }) {
  const width = settings.receiptWidthMm
  return (
    <PrintPortal pageCss={width === 210 ? 'size: A4; margin: 12mm' : `size: ${width}mm auto; margin: 0`}>
      <Receipt sale={sale} settings={settings} />
    </PrintPortal>
  )
}

export { printNow }
