import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { Providers } from '@/components/layout/providers'
import { hindSiliguri, inter } from './fonts'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app')
  return {
    title: t('title'),
    description: t('description'),
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
      apple: '/apple-touch-icon-180x180.png',
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
}

// Applies the saved theme and brand color before first paint, so there is no flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem('pos-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var h=localStorage.getItem('pos-hue');if(h!==null&&+h>=0&&+h<=360){document.documentElement.style.setProperty('--h',h);document.documentElement.setAttribute('data-accent','')}}catch(e){}`

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    // The theme script changes <html class> before React hydrates.
    <html lang={locale} className={`${inter.variable} ${hindSiliguri.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Passes this request's language and messages to client components. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
