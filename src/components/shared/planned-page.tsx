import { Hammer } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/states'
import { NAV_ITEMS } from '@/constants/navigation'

/**
 * Shown for modules scheduled in a later implementation phase. It deliberately has
 * no buttons: nothing on this page pretends to work.
 */
export function PlannedPage({ path }: { path: string }) {
  const item = NAV_ITEMS.find((i) => i.path === path)
  if (!item) return null
  return (
    <>
      <PageHeader title={item.label} />
      <EmptyState
        icon={Hammer}
        title="Not built yet"
        description={`${item.label} is scheduled for implementation phase ${item.phase}. The database tables it needs already exist.`}
      />
    </>
  )
}
