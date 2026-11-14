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
    <div className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md', hue.solid)}>
              <Icon className="size-5" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn('mt-4 h-0.5 rounded-full bg-gradient-to-r', hue.line)} aria-hidden />
    </div>
  )
}
