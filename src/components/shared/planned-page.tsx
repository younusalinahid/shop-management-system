import { Hammer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/states'
import { NAV_ITEMS, navKey } from '@/constants/navigation'

/**
 * Shown for modules scheduled in a later implementation phase. It deliberately has
 * no buttons: nothing on this page pretends to work.
 */
export function PlannedPage({ path }: { path: string }) {
  const t = useTranslations()
  const item = NAV_ITEMS.find((i) => i.path === path)
  if (!item) return null
  const label = t(`nav.${navKey(item.path)}`)
  return (
    <>
      <PageHeader title={label} />
      <EmptyState
        icon={Hammer}
        title={t('planned.title')}
        description={t('planned.description', { module: label, phase: item.phase })}
      />
    </>
  )
}
