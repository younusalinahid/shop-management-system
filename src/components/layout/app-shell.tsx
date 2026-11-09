'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { SidebarNav } from './sidebar-nav'
import { Topbar } from './topbar'

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations('shell')

  return (
    <div className="min-h-svh">
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-64 shadow-xl shadow-black/10 lg:block">
        <SidebarNav />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-0 p-0">
          <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
          <SheetDescription className="sr-only">{t('navigationDescription')}</SheetDescription>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
