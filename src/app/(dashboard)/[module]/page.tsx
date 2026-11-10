import { PlannedPage } from '@/components/shared/planned-page'
import { NAV_ITEMS } from '@/constants/navigation'

/**
 * Sidebar modules from later phases. Each gets a real exported page that says it is not built
 * yet. Built modules have their own folders, which take precedence over this dynamic segment.
 */
const BUILT = new Set(['/dashboard', '/pos', '/sales', '/products', '/categories', '/brands', '/barcodes', '/inventory', '/stock-movements', '/batches', '/purchases', '/customers', '/suppliers', '/customer-due', '/supplier-due', '/payments', '/sales-returns', '/purchase-returns', '/expenses', '/cash', '/shifts', '/settings'])

export const dynamicParams = false

export function generateStaticParams() {
  return NAV_ITEMS.filter((i) => !BUILT.has(i.path)).map((i) => ({ module: i.path.slice(1) }))
}

export default async function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params
  return <PlannedPage path={`/${module}`} />
}
