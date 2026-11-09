import '@testing-library/jest-dom/vitest'
import { sql } from 'drizzle-orm'
import { beforeEach, vi } from 'vitest'

// In-memory PostgreSQL (PGlite) with migrations applied; see src/server/db/index.ts.
process.env.PGLITE_DIR = 'memory://'
delete process.env.DATABASE_URL

// next/headers only works inside a real request. Tests get one shared in-memory cookie jar,
// so calling login, then another route, behaves like one browser.
const jar = new Map<string, string>()
// Shared with tests/helpers/cookies.ts so a test can set a cookie as the browser would (e.g. NEXT_LOCALE=bn).
;(globalThis as { __testCookies?: Map<string, string> }).__testCookies = jar
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}))

// jsdom lacks ResizeObserver, which Radix checkbox/switch use to size their hidden inputs.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Every test starts with empty tables and no session cookie.
beforeEach(async () => {
  jar.clear()
  const { getDb, schema } = await import('@/server/db')
  const db = await getDb()
  const tables = Object.values(schema)
    .map((t) => `"${(t as unknown as { [k: symbol]: string })[Symbol.for('drizzle:Name')]}"`)
    .join(', ')
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`))
})

// jsdom lacks scrollIntoView and pointer capture, which cmdk lists and Radix selects call.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= function () {}
}
