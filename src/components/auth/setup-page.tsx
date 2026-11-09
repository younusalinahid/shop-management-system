'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/layout/language-switcher'

// Same rules as the server's setup API (src/app/api/setup/route.ts).
const pinSchema = z.string().min(4, 'v.pinMin').max(32, 'v.pinMax')
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'v.usernameMin')
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'v.usernameChars')

const schema = z
  .object({
    shopName: z.string().trim().min(1, 'v.shopNameRequired').max(100),
    shopPhone: z.string().trim().max(30),
    shopAddress: z.string().trim().max(200),
    name: z.string().trim().min(1, 'v.yourNameRequired').max(80),
    username: usernameSchema,
    pin: pinSchema,
    confirmPin: z.string(),
  })
  .refine((v) => v.pin === v.confirmPin, { path: ['confirmPin'], message: 'v.pinsDontMatch' })

type Values = z.infer<typeof schema>

export function SetupPage() {
  const router = useRouter()
  const t = useTranslations('auth')
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { shopName: '', shopPhone: '', shopAddress: '', name: '', username: 'owner', pin: '', confirmPin: '' },
  })

  const onSubmit = async (v: Values) => {
    try {
      await api.post('/api/setup', { shopName: v.shopName, shopPhone: v.shopPhone, shopAddress: v.shopAddress, name: v.name, username: v.username, pin: v.pin })
      toast.success(t('shopSetUp'))
      router.replace('/dashboard')
      router.refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-gradient-to-br from-primary/15 via-background to-info/10 p-4">
      <div className="absolute top-3 right-3">
        <LanguageSwitcher compact={false} />
      </div>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">{t('setupTitle')}</CardTitle>
          <CardDescription>
            {t('setupDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="shopName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('shopName')}</FormLabel>
                    <FormControl>
                      <Input autoFocus placeholder={t('shopNamePlaceholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="shopPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('phoneOptional')}</FormLabel>
                      <FormControl>
                        <Input inputMode="tel" placeholder="01XXXXXXXXX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="shopAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('addressOptional')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Separator />
              <p className="text-sm font-medium">{t('ownerAccount')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('yourName')}</FormLabel>
                      <FormControl>
                        <Input autoComplete="name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('username')}</FormLabel>
                      <FormControl>
                        <Input autoComplete="username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('pinPassword')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('confirmPin')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('pinHint')}
              </p>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('settingUp') : t('createShop')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
