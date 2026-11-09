'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Service-worker lifecycle notifications. The worker (public/sw.js) is generated after
 * `next build` by scripts/generate-sw.mjs and only exists in production builds.
 * Updates are never applied automatically, so a reload can't interrupt a sale in progress.
 */
export function ReloadPrompt() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    let cancelled = false

    void import('workbox-window').then(({ Workbox }) => {
      if (cancelled) return
      const wb = new Workbox('/sw.js')

      wb.addEventListener('installed', (event) => {
        if (!event.isUpdate) toast.success('Ready to work offline', { description: 'The app is cached on this device.' })
      })
      wb.addEventListener('waiting', () => {
        toast('Update available', {
          description: 'Finish the current sale, then reload to update.',
          duration: Infinity,
          action: {
            label: 'Reload',
            onClick: () => {
              wb.addEventListener('controlling', () => window.location.reload())
              wb.messageSkipWaiting()
            },
          },
          cancel: { label: 'Later', onClick: () => {} },
        })
      })
      wb.register().catch((error: unknown) => console.error('Service worker registration failed', error))
    })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
