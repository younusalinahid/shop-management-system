'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ErrorState } from '@/components/shared/states'
import { errorMessage } from '@/lib/errors'

/** Catches a crash in one page; the sidebar and top bar stay usable. */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('errorsPage')
  useEffect(() => {
    console.error(error)
  }, [error])

  return <ErrorState title={t('pageErrorTitle')} message={errorMessage(error)} onRetry={retry} />
}
