'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Store } from 'lucide-react'
import { NAV_GROUPS } from '@/constants/navigation'
import { can } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'
import { useSettings } from '@/hooks/use-settings'

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const role = useSession((s) => s.user?.role)
  const settings = useSettings()
  const pathname = usePathname()
  // A section stays highlighted on its sub-pages (/products/view, /products/edit, …).
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Store className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{settings.shopName}</p>
          <p className="text-xs text-muted-foreground">Shop Management System</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => can(role, i.permission))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mb-4">
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      onClick={onNavigate}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        'focus-visible:outline-2 focus-visible:outline-ring',
                        isActive(item.path) && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
    </div>
  )
}
