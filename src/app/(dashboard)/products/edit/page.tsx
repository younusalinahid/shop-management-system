import { Suspense } from 'react'
import { ProductEditPage } from '@/components/products/product-form-page'

// Reads ?id= on the client; static export requires a Suspense boundary around useSearchParams.
export default function Page() {
  return (
    <Suspense>
      <ProductEditPage />
    </Suspense>
  )
}
