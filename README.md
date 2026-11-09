# Shop Management System (POS)

Point of Sale and shop management for retail and wholesale shops in Bangladesh.
Built with **Next.js 16** (App Router), TypeScript, **PostgreSQL** (Drizzle ORM) and REST-style
**API routes**. Data lives on the server, so every device that signs in sees the same shop.

## Requirements

- **Node.js 20 or newer** (developed with 22.x). With nvm-windows: `nvm use 22.23.2`.
- PostgreSQL for production (Neon, Supabase, Railway or your own). Local development needs nothing:
  without `DATABASE_URL`, the app runs **PGlite** (real Postgres in-process) in `./.data/pglite`.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173 → first visit opens the shop setup screen
```

## Scripts

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `npm run dev`         | Dev server on http://localhost:5173                                  |
| `npm run build`       | Production build                                                     |
| `npm start`           | Run the production build on port 5173                                |
| `npm test`            | All tests (Vitest; services, API routes and UI run on in-memory Postgres) |
| `npm run typecheck`   | TypeScript only                                                      |
| `npm run db:generate` | Create a SQL migration in `drizzle/` after editing `src/server/db/schema.ts` |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`                                   |
| `npm run db:studio`   | Browse the database (Drizzle Studio)                                 |

## Deploying to Vercel

1. Create a Postgres database (e.g. Neon) and copy its **pooled** connection string.
2. In Vercel → Project → Settings → Environment Variables, set `DATABASE_URL` (see `.env.example`).
3. Deploy. The `vercel-build` script applies migrations, then builds.

## Security notes

- PINs are stored as PBKDF2-SHA256 hashes. Sessions use a random token in an httpOnly cookie; the
  database keeps only its SHA-256.
- Every API route checks the signed-in user's role (`src/lib/permissions.ts`); the UI hiding a button
  is only a convenience.
- The login screen lists account names and roles (not PIN data) so a shared counter device can pick a user.
- Audit logs record who changed what. Back up the database regularly (your Postgres host's backups).

## Docs

- [Architecture](docs/ARCHITECTURE.md): folder layout, API, auth, core rules (money, quantities, transactions)
- [Database](docs/DATABASE.md): tables, constraints, migrations
