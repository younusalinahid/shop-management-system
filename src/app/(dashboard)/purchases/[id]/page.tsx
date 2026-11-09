import { PurchaseDetailPage } from '@/components/purchases/purchase-detail-page'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PurchaseDetailPage id={id} />
}
