import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Inbox, Loader2, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations('common')
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? t('loading')}
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-primary/25 bg-gradient-to-b from-primary/[0.05] to-transparent px-6 py-14 text-center">
      <div className="pointer-events-none absolute -top-20 left-1/2 size-56 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div className="relative mb-7 size-36" aria-hidden>
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/[0.12] to-primary/0 ring-1 ring-primary/10" />
        <div className="absolute inset-4 rounded-full bg-gradient-to-br from-primary/[0.18] to-primary/0 ring-1 ring-primary/15" />
        <div className="absolute inset-8 rounded-full bg-gradient-to-br from-primary/25 to-primary/[0.03] ring-1 ring-primary/25" />
        <div className="absolute top-3 left-2 size-9 -rotate-12 rounded-xl border border-primary/20 bg-card shadow-md" />
        <div className="absolute right-1 bottom-5 size-8 rotate-12 rounded-lg border border-primary/20 bg-card shadow-md" />
        <div className="bg-brand shadow-glow absolute inset-[2.6rem] flex items-center justify-center rounded-2xl text-white ring-1 ring-inset ring-white/30">
          <Icon className="size-7" strokeWidth={1.85} />
        </div>
        <Sparkles className="absolute top-1 right-5 size-4 text-primary" />
        <span className="absolute bottom-2 left-6 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.8)]" />
        <span className="absolute top-12 -right-1 size-1.5 rounded-full bg-primary/60" />
      </div>
      <h3 className="relative text-lg font-bold tracking-tight">{title}</h3>
      {description && <p className="relative mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  const t = useTranslations('common')
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="mb-3 size-8 text-destructive" aria-hidden />
      <h3 className="font-medium">{title ?? t('somethingWrong')}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {t('tryAgain')}
        </Button>
      )}
    </div>
  )
}
