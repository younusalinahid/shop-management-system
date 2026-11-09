import type { NextConfig } from 'next'

/**
 * Server-rendered Next.js app with Route Handlers under /api and PostgreSQL (see src/server/db).
 * PGlite (local development database) ships WebAssembly, so it is loaded from node_modules at
 * runtime instead of being bundled.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default nextConfig
