import { SaleDetailPage } from '@/components/sales/sale-detail-page'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SaleDetailPage id={id} />
}
