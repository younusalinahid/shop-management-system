import 'server-only'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * Database connection.
 * - DATABASE_URL set (Vercel, Neon, Supabase, any Postgres): postgres.js. Run `npm run db:migrate` to apply
 *   migrations (Vercel does it in `vercel-build`).
 * - DATABASE_URL not set (local development, tests): PGlite, which is real PostgreSQL compiled to WebAssembly,
 *   stored in PGLITE_DIR (default ./.data/pglite; "memory://" in tests). Migrations apply automatically.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

// Kept on globalThis so Next.js hot reloads in development reuse one connection.
const cache = globalThis as unknown as { __posDb?: Promise<Db> }

export function getDb(): Promise<Db> {
  cache.__posDb ??= connect().catch((e: unknown) => {
    cache.__posDb = undefined
    throw e
  })
  return cache.__posDb
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL
  if (url) {
    const [{ default: postgres }, { drizzle }] = await Promise.all([import('postgres'), import('drizzle-orm/postgres-js')])
    // prepare: false keeps it compatible with transaction-mode poolers (Neon, Supabase, PgBouncer).
    const client = postgres(url, { max: process.env.VERCEL ? 1 : 10, prepare: false })
    return drizzle(client, { schema }) as unknown as Db
  }
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ])
  const dir = process.env.PGLITE_DIR ?? './.data/pglite'
  // PGlite does not create missing parent folders for an on-disk database.
  if (!dir.includes('://')) (await import('node:fs')).mkdirSync(dir, { recursive: true })
  const client = new PGlite(dir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  return db as unknown as Db
}

export { schema }
