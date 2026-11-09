import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same JSX runtime as Next.js (tsconfig "jsx": "react-jsx"); no Vite React plugin needed for tests.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
})
