'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/shared/states'
import type { UserRole } from '@/types/db'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

interface LoginInfo {
  shopName: string
  users: Array<{ id: string; name: string; username: string; role: UserRole }>
}

export function LoginPage() {
  const router = useRouter()
  const t = useTranslations('auth')
  const tr = useTranslations('roles')
  const { data } = useQuery({ queryKey: ['login-info'], queryFn: () => api.get<LoginInfo>('/api/auth/users') })
  const users = data?.users
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (users?.length === 1 && !username) setUsername(users[0].username)
  }, [users, username])

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
          <CardDescription>{t('chooseAccount')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!users ? (
            <LoadingState />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">{t('user')}</legend>
                <div className="grid max-h-56 gap-2 overflow-y-auto">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setUsername(u.username)
                        pinRef.current?.focus()
                      }}
                      aria-pressed={username === u.username}
                      className={cn(
                        'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                        username === u.username && 'border-primary bg-accent',
                      )}
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">
                        {u.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-xs text-muted-foreground">{tr(u.role)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="pin">{t('pin')}</Label>
                <Input
                  id="pin"
                  ref={pinRef}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
