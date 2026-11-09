'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingState } from '@/components/shared/states'

/** "/" has no content of its own; static export has no server redirects, so redirect on the client. */
export default function HomePage() {
  const router = useRouter()
  useEffect(() => router.replace('/dashboard'), [router])
  return <LoadingState />
}
