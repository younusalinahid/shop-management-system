import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'
import { useTranslations } from 'next-intl'

export function NotFoundPage() {
  const t = useTranslations('errorsPage')
  return (
    <EmptyState
      icon={SearchX}
      title={t('notFoundTitle')}
      description={t('notFoundText')}
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('goToDashboard')}</Link>
        </Button>
      }
    />
  )
}

export function ForbiddenPage() {
  const t = useTranslations('errorsPage')
  return (
    <EmptyState
      title={t('forbiddenTitle')}
      description={t('forbiddenText')}
    />
  )
}
