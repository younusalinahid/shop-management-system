'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Store } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { NAV_GROUPS, navKey } from '@/constants/navigation'
import { can } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { hueForGroup } from '@/lib/section-colors'
import { useOnline } from '@/hooks/use-online'
import { useSessionUser } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'
import { useSidebarStore } from '@/stores/sidebar-store'

interface SidebarNavProps {
  onNavigate?: () => void
  /** Icon-only rail (desktop). The mobile drawer never collapses. */
  collapsed?: boolean
  /** Shows the collapse / expand button when given (desktop only). */
  onToggleCollapse?: () => void
}

/** Light sidebar: white surface in light mode, a deep slate surface in dark mode. */
export function SidebarNav({ onNavigate, collapsed = false, onToggleCollapse }: SidebarNavProps) {
  const user = useSessionUser()
  const settings = useSettings()
  const pathname = usePathname()
  const t = useTranslations()
  const closedGroups = useSidebarStore((s) => s.closedGroups)
  const toggleGroup = useSidebarStore((s) => s.toggleGroup)
  // A section stays highlighted on its sub-pages (/products/view, /products/edit, …).
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  const toggleLabel = collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')
  const toggle = onToggleCollapse && (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-label={toggleLabel}
      title={toggleLabel}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {collapsed ? <PanelLeftOpen className="size-[18px]" strokeWidth={1.85} aria-hidden /> : <PanelLeftClose className="size-[18px]" strokeWidth={1.85} aria-hidden />}
    </button>
  )

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-slate-700 dark:text-slate-300">
      {/* A faint indigo wash at the top keeps the white from feeling flat. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-indigo-50/70 to-transparent dark:from-indigo-500/10" aria-hidden />

      {/* Brand. */}
      <div className={cn('relative flex shrink-0 border-b border-slate-200/80 dark:border-white/10', collapsed ? 'flex-col items-center gap-2 py-3' : 'min-h-16 items-center gap-3 px-4 py-3')}>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-md shadow-indigo-500/30 ring-1 ring-inset ring-white/25">
          <Store className="size-5" strokeWidth={1.85} aria-hidden />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              <span className="font-display truncate text-base leading-tight font-bold tracking-tight text-slate-900 dark:text-white" title={settings.shopName}>{settings.shopName}</span>
              <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wider text-indigo-600 ring-1 ring-indigo-500/20 ring-inset dark:bg-indigo-500/15 dark:text-indigo-300">POS</span>
            </p>
            <p className="mt-0.5 text-xs leading-snug font-medium text-slate-500 dark:text-slate-400">{t('app.name')}</p>
          </div>
        )}
        {toggle}
      </div>

      <nav aria-label={t('shell.mainNavigation')} className="sidebar-scroll sidebar-scroll-light relative flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => can(user, i.permission))
          if (items.length === 0) return null
          const hue = hueForGroup(group.id)
          const folded = !collapsed && closedGroups.includes(group.id)
          const label = t(`navGroups.${group.id}`)
          return (
            <div key={group.id} className="mb-3 last:mb-0">
              {collapsed ? (
                <div className="mx-2 mb-2 h-px bg-slate-200/80 first:hidden dark:bg-white/10" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!folded}
                  className="flex w-full items-center gap-2 rounded-lg px-3.5 pt-1 pb-2 text-[11px] font-extrabold tracking-wider text-slate-500 uppercase outline-none transition-colors hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', hue.dot)} aria-hidden />
                  <span className="truncate">{label}</span>
                  <span className="h-px flex-1 bg-slate-200/80 dark:bg-white/10" aria-hidden />
                  <ChevronDown className={cn('size-3 shrink-0 transition-transform duration-200', folded && '-rotate-90')} strokeWidth={2.25} aria-hidden />
                </button>
              )}
              {/* Folding uses the grid-rows trick so the height animates. */}
              <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', folded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}>
                <ul className="min-h-0 space-y-0.5 overflow-hidden p-0.5 -m-0.5" inert={folded}>
                  {items.map((item) => {
                    const active = isActive(item.path)
                    const text = t(`nav.${navKey(item.path)}`)
                    return (
                      <li key={item.path}>
                        <Link
                          href={item.path}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          aria-label={collapsed ? text : undefined}
                          title={collapsed ? text : undefined}
                          className={cn(
                            'group relative flex items-center rounded-xl text-sm font-semibold tracking-[-0.005em] transition-all duration-200 outline-none',
                            'focus-visible:ring-2 focus-visible:ring-indigo-500',
                            collapsed ? 'justify-center p-2' : 'gap-3 px-3.5 py-2.5',
                            active
                              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 font-bold text-white shadow-md shadow-indigo-500/25 ring-1 ring-inset ring-white/15'
                              : 'text-slate-800 hover:bg-slate-100/80 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                              active
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 group-hover:translate-x-0.5 group-hover:bg-white group-hover:text-indigo-600 group-hover:shadow-sm group-hover:ring-1 group-hover:ring-slate-200 dark:group-hover:bg-white/10 dark:group-hover:text-white dark:group-hover:ring-0',
                            )}
                          >
                            <item.icon className="size-[18px]" strokeWidth={1.85} aria-hidden />
                          </span>
                          {!collapsed && <span className="truncate">{text}</span>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
      </nav>

      <SidebarFooter collapsed={collapsed} />
    </div>
  )
}

/** Who is signed in at which shop, with a live connection dot. */
function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const user = useSessionUser()
  const settings = useSettings()
  const online = useOnline()
  const t = useTranslations()
  if (!user) return null
  const dot = (
    <span className="relative flex size-2.5" aria-hidden>
      {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
      <span className={cn('relative inline-flex size-2.5 rounded-full ring-2 ring-slate-50 dark:ring-[#141a2e]', online ? 'bg-emerald-500' : 'bg-amber-500')} />
    </span>
  )
  const status = online ? t('shell.live') : t('shell.offline')
  const avatar = (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white ring-1 ring-inset ring-white/25">
      {user.name.slice(0, 1).toUpperCase()}
      <span className="absolute -right-0.5 -bottom-0.5">{dot}</span>
    </span>
  )
  return (
    <div className="relative shrink-0 border-t border-slate-200/80 p-3 dark:border-white/10">
      {collapsed ? (
        <div className="flex justify-center" title={`${user.name} · ${status}`}>
          {avatar}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/[0.04]">
          {avatar}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm leading-tight font-semibold break-words text-slate-900 dark:text-white" title={user.name}>
              {user.name}
            </p>
            <p className="mt-0.5 text-xs leading-tight font-medium text-slate-600 dark:text-slate-300">{t(`roles.${user.role}`)}</p>
            <p className={cn('mt-1 flex items-center gap-1 text-[11px] leading-tight font-semibold', online ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
              {status}
              <span className="truncate font-medium text-slate-500 dark:text-slate-400" title={settings.shopName}>
                · {settings.shopName}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
