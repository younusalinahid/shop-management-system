'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/shared/states'
import { useSettings } from '@/hooks/use-settings'
import { ROLE_LABELS } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { listActiveUsers, login } from '@/services/auth-service'
import { errorMessage } from '@/services/errors'
import { useSession } from '@/stores/session-store'

export function LoginPage() {
  const settings = useSettings()
  const users = useLiveQuery(listActiveUsers, [])
  const signIn = useSession((s) => s.signIn)
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
      signIn(await login(username, pin))
    } catch (err) {
      setError(errorMessage(err))
      setPin('')
      pinRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">{settings.shopName}</CardTitle>
          <CardDescription>Choose your account and enter your PIN</CardDescription>
        </CardHeader>
        <CardContent>
          {!users ? (
            <LoadingState />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">User</legend>
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
                        <span className="block text-xs text-muted-foreground">{ROLE_LABELS[u.role]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="pin">PIN</Label>
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
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
