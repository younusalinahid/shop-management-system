import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from '@/components/layout/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shop Management System (POS)',
  description: 'Offline-first POS and shop management for retail and wholesale shops.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
    apple: '/apple-touch-icon-180x180.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
}

// Applies the saved theme before first paint, so there is no flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem('pos-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script changes <html class> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
