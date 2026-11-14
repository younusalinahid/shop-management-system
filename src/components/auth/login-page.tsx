'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'

interface LoginInfo {
  shopName: string
  demo: { username: string; password: string } | null
}

export function LoginPage() {
  const router = useRouter()
  const t = useTranslations('auth')
  const { data } = useQuery({ queryKey: ['login-info'], queryFn: () => api.get<LoginInfo>('/api/auth/users') })
  const demo = data?.demo
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !pin) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { username, pin })
      // The session cookie is set; load the app (server layouts read the cookie).
      router.replace('/dashboard')
      router.refresh()
      return
    } catch (err) {
      setError(errorMessage(err))
      setPin('')
      pinRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-gradient-to-br from-primary/15 via-background to-info/10 p-4">
      <div className="absolute top-3 right-3">
        <LanguageSwitcher compact={false} />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">{data?.shopName ?? t('signIn')}</CardTitle>
          <CardDescription>{t('enterCredentials')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('username')}</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">{t('pin')}</Label>
              <Input
                id="pin"
                ref={pinRef}
                type="password"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
              />
              {error && (
                <p id="login-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy || !username || !pin}>
              {busy ? t('signingIn') : t('signIn')}
            </Button>
          </form>
          {demo && (
            <div className="mt-5 rounded-md border border-dashed bg-muted/40 p-3 text-sm">
              <p className="font-medium">{t('demoTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('demoHint')}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('username')}</dt>
                <dd className="font-mono">{demo.username}</dd>
                <dt className="text-muted-foreground">{t('pin')}</dt>
                <dd className="font-mono">{demo.password}</dd>
              </dl>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  setUsername(demo.username)
                  setPin(demo.password)
                  setError(null)
                  pinRef.current?.focus()
                }}
              >
                {t('demoFill')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
