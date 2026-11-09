'use client'

import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { ReloadPrompt } from '@/components/shared/reload-prompt'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { db } from '@/db/database'
import { ensureDefaults } from '@/db/bootstrap'
import { configureTimeZone } from '@/lib/datetime'
import { configureMoneyFormat } from '@/lib/money'
import { LoginPage } from '@/components/auth/login-page'
import { SetupPage } from '@/components/auth/setup-page'
import { hasAnyUser } from '@/services/auth-service'
import { errorMessage } from '@/services/errors'
import { getSettings } from '@/services/settings-service'
import { requestPersistentStorage } from '@/services/storage-service'
import { useSession } from '@/stores/session-store'

type BootState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; hasUsers: boolean }

async function boot(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('This browser does not support IndexedDB, which the app needs to store data.')
  }
  await db.open()
  await ensureDefaults()
  const settings = await getSettings()
  configureTimeZone(settings.timezone)
  configureMoneyFormat({ locale: settings.locale, symbol: settings.currencySymbol })
  // Best effort; the browser may refuse or ignore this.
  void requestPersistentStorage()
  return hasAnyUser()
}

/**
 * Client-side gate around every page: opens IndexedDB, then shows first-run setup, the login
 * screen, or the requested page. Nothing below it renders until the database is ready, so pages
 * never touch IndexedDB during the static-export prerender.
 */
export function AppBoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootState>({ kind: 'loading' })
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)

  const start = useCallback(() => {
    setState({ kind: 'loading' })
    boot()
      .then((hasUsers) => setState({ kind: 'ready', hasUsers }))
      .catch((e) => setState({ kind: 'error', message: errorMessage(e) }))
  }, [])

  useEffect(start, [start])

  // A session that points at a user deleted by a restore is discarded.
  useEffect(() => {
    if (state.kind === 'ready' && user) {
      void db.users.get(user.id).then((u) => {
        if (!u || u.status !== 'active') signOut()
      })
    }
  }, [state.kind, user, signOut])

  let content
  if (state.kind === 'loading') content = <LoadingState label="Opening shop database…" className="min-h-svh" />
  else if (state.kind === 'error')
    content = (
      <div className="flex min-h-svh items-center justify-center p-4">
        <ErrorState title="Could not open the database" message={state.message} onRetry={start} />
      </div>
    )
  else if (!state.hasUsers) content = <SetupPage onDone={() => setState({ kind: 'ready', hasUsers: true })} />
  else if (!user) content = <LoginPage />
  else content = children

  return (
    <TooltipProvider delayDuration={300}>
      {content}
      <Toaster richColors closeButton position="top-right" />
      <ReloadPrompt />
    </TooltipProvider>
  )
}
