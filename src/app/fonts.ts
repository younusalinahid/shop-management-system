import { Hind_Siliguri, Inter, Plus_Jakarta_Sans } from 'next/font/google'

/**
 * UI fonts, self-hosted by next/font (no request to Google at runtime).
 * Plus Jakarta Sans is the display face (headings, page titles, KPI numbers); Inter is the UI face
 * (body text, sidebar, tables). Hind Siliguri is designed for Bangla on screens and takes over for
 * Bangla text automatically through the font stacks in globals.css.
 */
export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-latin-display',
})

export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-latin-ui',
})

export const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-bangla',
})
