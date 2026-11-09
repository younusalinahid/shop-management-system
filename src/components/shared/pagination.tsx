import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Client-side pagination over an already-filtered list. Resets to page 1 when the list shrinks. */
export function usePagination<T>(items: readonly T[], pageSize = 25) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(1)
  }, [page, pageCount])
  const current = Math.min(page, pageCount)
  return {
    page: current,
    pageCount,
    setPage,
    rows: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    from: items.length === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, items.length),
  }
}

export function Pagination({ page, pageCount, setPage, total, from, to }: Omit<ReturnType<typeof usePagination>, 'rows'>) {
  const t = useTranslations('common')
  if (total === 0) return null
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <span>
        {t('rangeOf', { from, to, total })}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t('previousPage')}>
          <ChevronLeft />
        </Button>
        <span className="px-1">
          {page} / {pageCount}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label={t('nextPage')}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
