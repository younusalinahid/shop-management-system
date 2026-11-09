import { BarcodesPage } from '@/components/barcodes/barcodes-page'

/** /barcodes?product=<id> pre-fills the label queue with that product's barcodes. */
export default async function Page({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams
  return <BarcodesPage productId={product} />
}
