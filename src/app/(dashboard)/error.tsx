'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/shared/states'
import { errorMessage } from '@/services/errors'

/** Catches a crash in one page; the sidebar and top bar stay usable. */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return <ErrorState title="This page hit an error" message={errorMessage(error)} onRetry={retry} />
}
