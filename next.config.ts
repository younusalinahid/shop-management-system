import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

/**
 * Server-rendered Next.js app with Route Handlers under /api and PostgreSQL (see src/server/db).
 * PGlite (local development database) ships WebAssembly, so it is loaded from node_modules at
 * runtime instead of being bundled.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@electric-sql/pglite'],
}

// Language config: src/i18n/request.ts (English / Bangla, chosen by cookie).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withNextIntl(nextConfig)
