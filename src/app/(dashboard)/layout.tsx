'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ForbiddenPage } from '@/components/shared/not-found-page'
import { AppShell } from '@/components/layout/app-shell'
import { routePermission } from '@/constants/navigation'
import { can } from '@/lib/permissions'
import { useSession } from '@/stores/session-store'

/** Shell for every signed-in page, with the route's role check (services re-check on writes). */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const role = useSession((s) => s.user?.role)
  const permission = routePermission(pathname)
  return <AppShell>{permission && !can(role, permission) ? <ForbiddenPage /> : children}</AppShell>
}
