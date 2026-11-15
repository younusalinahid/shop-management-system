'use client'

import type { LucideIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { hueForPath } from '@/lib/section-colors'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  /** Shown in a tile next to the title, colored by the sidebar section the page belongs to. */
  icon?: LucideIcon
  actions?: ReactNode
}

export function PageHeader({ title, description, icon: Icon, actions }: PageHeaderProps) {
  const hue = hueForPath(usePathname())
  return (
    <div className="relative mb-7 overflow-hidden rounded-2xl border border-[var(--card-edge)] bg-card p-4 shadow-[var(--shadow-card)] ring-1 ring-[var(--card-ring)] sm:p-5">
      <div className={cn('pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-gradient-to-br blur-3xl', hue.glow)} aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {Icon && (
            <div className="relative shrink-0">
              <span className={cn('absolute -inset-2.5 rounded-[1.6rem] bg-gradient-to-br opacity-60 blur-md', hue.glow)} aria-hidden />
              <span className={cn('absolute -inset-1 rounded-[1.25rem] bg-gradient-to-br opacity-40', hue.glow)} aria-hidden />
              <div className={cn('relative flex size-12 items-center justify-center rounded-2xl', hue.solid)}>
                <Icon className="size-6" strokeWidth={1.85} aria-hidden />
              </div>
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display truncate text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h1>
            {description && <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
