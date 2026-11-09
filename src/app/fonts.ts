import { Hind_Siliguri, Inter } from 'next/font/google'

/**
 * UI fonts, self-hosted by next/font (no request to Google at runtime).
 * Inter covers English; Hind Siliguri is designed for Bangla on screens and takes over for
 * Bangla text automatically through the font stack in globals.css.
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-bangla',
})
