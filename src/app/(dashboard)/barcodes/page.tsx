import { Suspense } from 'react'
import { BarcodesPage } from '@/components/barcodes/barcodes-page'

// Reads ?product= on the client; static export requires a Suspense boundary around useSearchParams.
export default function Page() {
  return (
    <Suspense>
      <BarcodesPage />
    </Suspense>
  )
}
