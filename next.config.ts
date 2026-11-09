import type { NextConfig } from 'next'

/**
 * Static export only: the app has no server. Every page is pre-rendered to HTML in `out/`
 * and all data lives in the browser's IndexedDB. Server features (API routes, Server Actions,
 * dynamic rendering, middleware) are intentionally unused and unavailable in this mode.
 */
const nextConfig: NextConfig = {
  output: 'export',
  // /products is exported as products.html; static hosts and the service worker map clean URLs to it.
  trailingSlash: false,
  images: { unoptimized: true },
  reactStrictMode: true,
}

export default nextConfig
