# Database

PostgreSQL, accessed through Drizzle ORM. The source of truth is `src/server/db/schema.ts`; SQL migrations are
generated into `drizzle/` and committed.

- **Production:** `DATABASE_URL` (Neon, Supabase, any Postgres). Use the pooled URL on serverless hosts.
- **Local development:** no `DATABASE_URL` → PGlite (Postgres compiled to WebAssembly) in `./.data/pglite`.
  Delete that folder to start over.
- **Tests:** PGlite in memory; every test starts with empty tables.

## Changing the schema

1. Edit `src/server/db/schema.ts`.
2. `npm run db:generate` → a new file in `drizzle/`. Review the SQL and commit it.
3. Local PGlite applies it on the next start. For Postgres, `npm run db:migrate` (Vercel runs it in `vercel-build`).
4. Never edit a migration that has been applied anywhere; add a new one.

## Conventions

- Primary keys are UUIDs, except `settings.id = 'app'` and `counters.id = 'product' | 'barcode' | …`.
- Money is BIGINT poisha; quantities are BIGINT base units. Both are read as JS numbers (well below 2^53).
- Timestamps are TIMESTAMPTZ, converted to epoch milliseconds in the app (`timestampMs` custom type).
- Names that must be unique are unique case-insensitively (`UNIQUE (lower(name))`).
- Records with history are archived (`status`), never deleted.

## Tables

| Table | Constraints / indexes | Notes |
| --- | --- | --- |
| settings | PK id | One row `'app'`, settings in `data` (JSONB), merged over defaults |
| counters | PK id | Atomic `INSERT … ON CONFLICT DO UPDATE value + 1` |
| users | UNIQUE username | PBKDF2 PIN hash + salt, role, status |
| sessions | FK user (cascade) | `id` = SHA-256 of the cookie token; `expires_at` |
| audit_logs | created_at, entity_id, (module, action) | Before/after as JSONB |
| categories | UNIQUE lower(name), FK parent | Nested categories; archived, never deleted |
| brands | UNIQUE lower(name) | Archived, never deleted |
| products | UNIQUE sku, FK category/brand | Cached `stock_qty` (base units) and `stock_value` (poisha) |
| product_units | UNIQUE (product, lower(name)); UNIQUE product WHERE is_base | `factor` = base units per unit; independent prices |
| product_barcodes | UNIQUE code, FK product (cascade), FK unit (set null) | Optional unit: a scan selects that package |
| product_batches | (product, expiry_date) | FEFO; `9999-12-31` = no expiry. `qty_remaining` falls as stock leaves |
| stock_movements | (product, created_at), ref_id | Signed qty and value change, balance after. Every stock change has one |
| suppliers | UNIQUE lower(name) | Cached payable `balance` (opening balance + purchase dues) |
| purchases | UNIQUE purchase_no, UNIQUE idempotency_key | Totals, paid, due; cancelled, never deleted (migration 0001) |
| purchase_items | FK purchase (cascade), product, batch | Snapshots: name, unit, factor, decimal quantity, base qty, cost, landed cost |

Sales, returns, customers, payments, cash, shifts and the ledger are added by migrations in their phases.
