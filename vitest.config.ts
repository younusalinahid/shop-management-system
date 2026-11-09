import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same JSX runtime as Next.js (tsconfig "jsx": "react-jsx"); no Vite React plugin needed for tests.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/helpers/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    css: false,
    // PGlite takes a moment to start and migrate per test file.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
})
