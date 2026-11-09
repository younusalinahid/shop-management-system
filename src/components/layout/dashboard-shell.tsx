'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ForbiddenPage } from '@/components/shared/not-found-page'
import { routePermission } from '@/constants/navigation'
import { useSessionUser } from '@/hooks/use-session'
import { can } from '@/lib/permissions'
import { AppShell } from './app-shell'

/** App shell plus the page's role check (the API enforces permissions on every request too). */
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { role } = useSessionUser()
  const permission = routePermission(pathname)
  return <AppShell>{permission && !can(role, permission) ? <ForbiddenPage /> : children}</AppShell>
}
