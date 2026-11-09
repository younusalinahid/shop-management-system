'use client'

import { useEffect, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Control, type FieldPath } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Settings as SettingsIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { AppSettings } from '@/types/db'
import { integerToDecimalString, mulToInteger, parseDecimal } from '@/lib/decimal'
import { errorMessage } from '@/lib/errors'
import { useRefreshData } from '@/hooks/use-catalog'
import { settingsQuery } from '@/hooks/use-settings'
import { api } from '@/lib/api-client'
import { LOCALE_LABELS, type Locale } from '@/i18n/config'

const percent = z
  .string()
  .trim()
  .refine((s) => {
    try {
      const d = parseDecimal(s || '0')
      return d.scale <= 2 && d.units >= 0n && mulToInteger(d, 100, 'exact') <= 10000
    } catch {
      return false
    }
  }, 'v.percentage')

const schema = z.object({
  shopName: z.string().trim().min(1, 'v.shopNameRequired').max(100),
  shopPhone: z.string().trim().max(30),
  shopAddress: z.string().trim().max(200),
  invoicePrefix: z.string().trim().min(1, 'v.required').max(10).regex(/^[A-Za-z0-9-/]+$/, 'v.prefixChars'),
  purchasePrefix: z.string().trim().min(1, 'v.required').max(10).regex(/^[A-Za-z0-9-/]+$/, 'v.prefixChars'),
  invoiceFooter: z.string().trim().max(300),
  receiptWidthMm: z.enum(['58', '80', '210']),
  defaultTaxRate: percent,
  pricesIncludeTax: z.boolean(),
  defaultPriceMode: z.enum(['retail', 'wholesale']),
  expiryWarningDays: z.coerce.number().int('v.wholeDays').min(0, 'v.daysRange').max(365, 'v.daysRange'),
  allowNegativeStock: z.boolean(),
  allowExpiredSale: z.boolean(),
  allowMultipleOpenShifts: z.boolean(),
  requireShiftForSale: z.boolean(),
})

type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

function toValues(s: AppSettings): Values {
  return {
    shopName: s.shopName,
    shopPhone: s.shopPhone,
    shopAddress: s.shopAddress,
    invoicePrefix: s.invoicePrefix,
    purchasePrefix: s.purchasePrefix,
    invoiceFooter: s.invoiceFooter,
    receiptWidthMm: String(s.receiptWidthMm) as Values['receiptWidthMm'],
    defaultTaxRate: integerToDecimalString(s.defaultTaxRate, 2),
    pricesIncludeTax: s.pricesIncludeTax,
    defaultPriceMode: s.defaultPriceMode,
    expiryWarningDays: s.expiryWarningDays,
    allowNegativeStock: s.allowNegativeStock,
    allowExpiredSale: s.allowExpiredSale,
    allowMultipleOpenShifts: s.allowMultipleOpenShifts,
    requireShiftForSale: s.requireShiftForSale,
  }
}

export function SettingsPage() {
  const { data: settings } = useQuery(settingsQuery)
  const t = useTranslations('settings')
  const locale = useLocale() as Locale
  const refresh = useRefreshData()
  const form = useForm<Values, unknown, Parsed>({ resolver: zodResolver(schema) })

  useEffect(() => {
    // Load once; don't clobber in-progress edits on live updates.
    if (settings && !form.formState.isDirty) form.reset(toValues(settings))
  }, [settings, form])

  if (!settings) return <LoadingState />

  const onSubmit = async (v: Parsed) => {
    try {
      const next = await api.patch<AppSettings>('/api/settings', {
        ...v,
        receiptWidthMm: Number(v.receiptWidthMm) as AppSettings['receiptWidthMm'],
        defaultTaxRate: mulToInteger(v.defaultTaxRate || '0', 100, 'exact'),
      })
      form.reset(toValues(next))
      await refresh()
      toast.success(t('saved'))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const c = form.control
  return (
    <>
      <PageHeader icon={SettingsIcon} title={t('title')} description={t('description')} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 xl:grid-cols-2" noValidate>
          <Section title={t('shopInfo')} description={t('shopInfoHint')}>
            <TextField control={c} name="shopName" label={t('shopName')} />
            <TextField control={c} name="shopPhone" label={t('phone')} />
            <FormField
              control={c}
              name="shopAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('address')}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title={t('invoices')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={c} name="invoicePrefix" label={t('invoicePrefix')} description={t('example', { value: 'INV-000123' })} />
              <TextField control={c} name="purchasePrefix" label={t('purchasePrefix')} description={t('example', { value: 'PUR-000045' })} />
            </div>
            <FormField
              control={c}
              name="receiptWidthMm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('receiptPaper')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="58">{t('thermal', { mm: 58 })}</SelectItem>
                      <SelectItem value="80">{t('thermal', { mm: 80 })}</SelectItem>
                      <SelectItem value="210">{t('a4')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={c}
              name="invoiceFooter"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('invoiceFooter')}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title={t('taxPricing')}>
            <TextField control={c} name="defaultTaxRate" label={t('defaultTax')} inputMode="decimal" description={t('defaultTaxHint')} />
            <SwitchField control={c} name="pricesIncludeTax" label={t('pricesIncludeTax')} description={t('pricesIncludeTaxHint')} />
            <FormField
              control={c}
              name="defaultPriceMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceMode')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="retail">{t('retail')}</SelectItem>
                      <SelectItem value="wholesale">{t('wholesale')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title={t('stockRules')}>
            <TextField control={c} name="expiryWarningDays" label={t('expiryWarning')} inputMode="numeric" description={t('expiryWarningHint')} />
            <SwitchField control={c} name="allowNegativeStock" label={t('negativeStock')} description={t('negativeStockHint')} />
            <SwitchField control={c} name="allowExpiredSale" label={t('expiredOverride')} description={t('expiredOverrideHint')} />
            <SwitchField control={c} name="requireShiftForSale" label={t('requireShift')} />
            <SwitchField control={c} name="allowMultipleOpenShifts" label={t('multipleShifts')} />
          </Section>

          <Section title={t('region')} description={t('regionHint')}>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('currency')}</dt>
              <dd>BDT (৳)</dd>
              <dt className="text-muted-foreground">{t('timezone')}</dt>
              <dd>Asia/Dhaka</dd>
              <dt className="text-muted-foreground">{t('dateFormat')}</dt>
              <dd>DD/MM/YYYY</dd>
              <dt className="text-muted-foreground">{t('language')}</dt>
              <dd>{t('languageValue', { language: LOCALE_LABELS[locale] })}</dd>
            </dl>
          </Section>

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 xl:col-span-2">
            <Button type="button" variant="outline" disabled={!form.formState.isDirty} onClick={() => form.reset(toValues(settings))}>
              {t('discard')}
            </Button>
            <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

interface FieldProps {
  control: Control<Values, unknown, Parsed>
  name: FieldPath<Values>
  label: string
  description?: string
}

function TextField({ control, name, label, description, inputMode }: FieldProps & { inputMode?: 'decimal' | 'numeric' }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input inputMode={inputMode} {...field} value={String(field.value ?? '')} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function SwitchField({ control, name, label, description }: FieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

