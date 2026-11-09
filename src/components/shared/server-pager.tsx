import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

/** Pager for lists paginated on the server (`total` rows overall, `pageSize` per page). */
export function ServerPager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const t = useTranslations('common')
  if (total === 0) return null
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <span>{t('rangeOf', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('previousPage')}>
          <ChevronLeft />
        </Button>
        <span className="px-1">
          {page} / {pageCount}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t('nextPage')}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
