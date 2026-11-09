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

// Same rules as the server's setup API (src/app/api/setup/route.ts).
const pinSchema = z.string().min(4, 'PIN must be at least 4 characters').max(32, 'PIN is too long')
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Username must be at least 2 characters')
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore')

const schema = z
  .object({
    shopName: z.string().trim().min(1, 'Shop name is required').max(100),
    shopPhone: z.string().trim().max(30),
    shopAddress: z.string().trim().max(200),
    name: z.string().trim().min(1, 'Your name is required').max(80),
    username: usernameSchema,
    pin: pinSchema,
    confirmPin: z.string(),
  })
  .refine((v) => v.pin === v.confirmPin, { path: ['confirmPin'], message: 'PINs do not match' })

type Values = z.infer<typeof schema>

export function SetupPage() {
  const router = useRouter()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { shopName: '', shopPhone: '', shopAddress: '', name: '', username: 'owner', pin: '', confirmPin: '' },
  })

  const onSubmit = async (v: Values) => {
    try {
      await api.post('/api/setup', { shopName: v.shopName, shopPhone: v.shopPhone, shopAddress: v.shopAddress, name: v.name, username: v.username, pin: v.pin })
      toast.success('Shop set up')
      router.replace('/dashboard')
      router.refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">Set up your shop</CardTitle>
          <CardDescription>
            Creates the owner account for your shop. You can change these details later in Settings.
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
                    <FormLabel>Shop name</FormLabel>
                    <FormControl>
                      <Input autoFocus placeholder="Enter your shop name" {...field} />
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
                      <FormLabel>Phone (optional)</FormLabel>
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
                      <FormLabel>Address (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Separator />
              <p className="text-sm font-medium">Owner account</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Your name</FormLabel>
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
                      <FormLabel>Username</FormLabel>
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
                      <FormLabel>PIN / password</FormLabel>
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
                      <FormLabel>Confirm PIN</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use a PIN only you know. Every sale and change is recorded under the account that made it.
              </p>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Setting up…' : 'Create shop'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
