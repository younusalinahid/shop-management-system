import type { ReactNode } from 'react'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { SessionProvider } from '@/hooks/use-session'
import { requirePageUser } from '@/server/auth/entry'

/** Every signed-in page: verifies the session cookie on the server, then renders the app shell. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser()
  return (
    <SessionProvider user={user}>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  )
}
