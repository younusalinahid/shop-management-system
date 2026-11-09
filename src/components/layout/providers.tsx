'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useThemeStore } from '@/stores/theme-store'

/** App-wide client providers: data fetching cache (React Query), tooltips and toasts. */
export function Providers({ children }: { children: ReactNode }) {
  // The <html> class is already set by the inline theme script; this syncs the theme menu with it.
  useEffect(() => useThemeStore.getState().hydrate(), [])
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Shop data changes from other counters too; refetch when the window regains focus.
          queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
