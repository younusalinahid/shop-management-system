'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useSidebarStore } from '@/stores/sidebar-store'
import { SidebarNav } from './sidebar-nav'
import { Topbar } from './topbar'

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations('shell')
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const hydrate = useSidebarStore((s) => s.hydrate)
  useEffect(() => hydrate(), [hydrate])

  return (
    <div className="min-h-svh">
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200 bg-white/95 shadow-[6px_0_28px_-14px_rgb(15_23_42/0.14)] backdrop-blur-md transition-[width] duration-200 ease-out lg:block dark:border-white/10 dark:bg-[#0f1424]/95 dark:shadow-black/40',
          collapsed ? 'w-[4.75rem]' : 'w-64',
        )}
      >
        <SidebarNav collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-0 bg-white p-0 dark:bg-[#0f1424]">
          <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
          <SheetDescription className="sr-only">{t('navigationDescription')}</SheetDescription>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className={cn('transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-[4.75rem]' : 'lg:pl-64')}>
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
