'use client'

import { useEffect, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Control, type FieldPath } from 'react-hook-form'
import { useLiveQuery } from 'dexie-react-hooks'
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
import { errorMessage } from '@/services/errors'
import { getSettings, updateSettings } from '@/services/settings-service'
import { currentActor } from '@/stores/session-store'

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
  }, 'Enter a percentage between 0 and 100 with up to 2 decimals')

const schema = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required').max(100),
  shopPhone: z.string().trim().max(30),
  shopAddress: z.string().trim().max(200),
  invoicePrefix: z.string().trim().min(1, 'Required').max(10).regex(/^[A-Za-z0-9-/]+$/, 'Letters, numbers, - or / only'),
  purchasePrefix: z.string().trim().min(1, 'Required').max(10).regex(/^[A-Za-z0-9-/]+$/, 'Letters, numbers, - or / only'),
  invoiceFooter: z.string().trim().max(300),
  receiptWidthMm: z.enum(['58', '80', '210']),
  defaultTaxRate: percent,
  pricesIncludeTax: z.boolean(),
  defaultPriceMode: z.enum(['retail', 'wholesale']),
  expiryWarningDays: z.coerce.number().int('Whole days only').min(0).max(365),
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
  const settings = useLiveQuery(getSettings, [])
  const form = useForm<Values, unknown, Parsed>({ resolver: zodResolver(schema) })

  useEffect(() => {
    // Load once; don't clobber in-progress edits on live updates.
    if (settings && !form.formState.isDirty) form.reset(toValues(settings))
  }, [settings, form])

  if (!settings) return <LoadingState />

  const onSubmit = async (v: Parsed) => {
    try {
      const next = await updateSettings(currentActor(), {
        ...v,
        receiptWidthMm: Number(v.receiptWidthMm) as AppSettings['receiptWidthMm'],
        defaultTaxRate: mulToInteger(v.defaultTaxRate || '0', 100, 'exact'),
      })
      form.reset(toValues(next))
      toast.success('Settings saved')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const c = form.control
  return (
    <>
      <PageHeader title="Settings" description="Shop details, invoices, tax and sales rules." />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 xl:grid-cols-2" noValidate>
          <Section title="Shop information" description="Printed on invoices and receipts.">
            <TextField control={c} name="shopName" label="Shop name" />
            <TextField control={c} name="shopPhone" label="Phone" />
            <FormField
              control={c}
              name="shopAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title="Invoices & receipts">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={c} name="invoicePrefix" label="Invoice prefix" description="e.g. INV-000123" />
              <TextField control={c} name="purchasePrefix" label="Purchase prefix" description="e.g. PUR-000045" />
            </div>
            <FormField
              control={c}
              name="receiptWidthMm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receipt paper</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="58">58 mm thermal</SelectItem>
                      <SelectItem value="80">80 mm thermal</SelectItem>
                      <SelectItem value="210">A4 page</SelectItem>
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
                  <FormLabel>Invoice footer</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title="Tax & pricing">
            <TextField control={c} name="defaultTaxRate" label="Default VAT / tax rate (%)" inputMode="decimal" description="Used for new products. 0 for no tax." />
            <SwitchField control={c} name="pricesIncludeTax" label="Selling prices include tax" description="When on, tax is extracted from the price instead of added on top." />
            <FormField
              control={c}
              name="defaultPriceMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default POS price mode</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title="Stock & sales rules">
            <TextField control={c} name="expiryWarningDays" label="Expiry warning (days)" inputMode="numeric" description="Batches expiring within this many days are flagged." />
            <SwitchField control={c} name="allowNegativeStock" label="Allow selling below zero stock" description="Not recommended. Off keeps stock counts trustworthy." />
            <SwitchField control={c} name="allowExpiredSale" label="Allow owner override for expired stock" description="Expired batches stay blocked for everyone else. Every override is audit-logged." />
            <SwitchField control={c} name="requireShiftForSale" label="Require an open shift to sell" />
            <SwitchField control={c} name="allowMultipleOpenShifts" label="Allow a cashier to have more than one open shift" />
          </Section>

          <Section title="Region" description="Fixed for this release.">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Currency</dt>
              <dd>BDT (৳)</dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd>Asia/Dhaka</dd>
              <dt className="text-muted-foreground">Date format</dt>
              <dd>DD/MM/YYYY</dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd>English</dd>
            </dl>
          </Section>

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 xl:col-span-2">
            <Button type="button" variant="outline" disabled={!form.formState.isDirty} onClick={() => form.reset(toValues(settings))}>
              Discard changes
            </Button>
            <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save settings'}
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

