'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Store } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { NAV_GROUPS, navKey } from '@/constants/navigation'
import { can } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useSessionUser } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useSessionUser()
  const settings = useSettings()
  const pathname = usePathname()
  const t = useTranslations()
  // A section stays highlighted on its sub-pages (/products/view, /products/edit, …).
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-active to-primary text-white shadow-md shadow-black/20">
          <Store className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-bold text-white">{settings.shopName}</p>
          <p className="truncate text-xs text-sidebar-muted">{t('app.name')}</p>
        </div>
      </div>
      <nav aria-label={t('shell.mainNavigation')} className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => can(role, i.permission))
          if (items.length === 0) return null
          return (
            <div key={group.id} className="mb-5">
              <p className="px-3 pb-1.5 text-[11px] font-bold tracking-wider text-sidebar-muted uppercase">{t(`navGroups.${group.id}`)}</p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      onClick={onNavigate}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                        'hover:bg-white/10 hover:text-white',
                        'focus-visible:outline-2 focus-visible:outline-sidebar-active',
                        isActive(item.path) &&
                          'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm shadow-black/10 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-sidebar-active',
                      )}
                    >
                      <item.icon className={cn('size-4 shrink-0 transition-colors', isActive(item.path) ? 'text-sidebar-active' : 'text-sidebar-muted group-hover:text-white')} aria-hidden />
                      <span className="truncate">{t(`nav.${navKey(item.path)}`)}</span>
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
