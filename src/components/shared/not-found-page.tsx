import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={SearchX}
      title="Page not found"
      description="The page you are looking for does not exist."
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      }
    />
  )
}

export function ForbiddenPage() {
  return (
    <EmptyState
      title="Access restricted"
      description="Your role does not have permission to open this page. Ask the shop owner if you need access."
    />
  )
}
