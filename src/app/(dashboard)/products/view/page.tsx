import { Suspense } from 'react'
import { ProductDetailPage } from '@/components/products/product-detail-page'

// Reads ?id= on the client; static export requires a Suspense boundary around useSearchParams.
export default function Page() {
  return (
    <Suspense>
      <ProductDetailPage />
    </Suspense>
  )
}
