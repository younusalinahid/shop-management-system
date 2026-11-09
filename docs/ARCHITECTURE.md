# Architecture

## Stack

Next.js 16 (App Router, server-rendered) · React 19 · TypeScript 5.9 · PostgreSQL via Drizzle ORM (PGlite for local
development and tests) · Route Handlers as a JSON API · TanStack Query (client data cache) · Tailwind CSS 4 +
shadcn/ui (Radix) · Lucide · Zustand (theme only) · React Hook Form + Zod · Recharts · Vitest + Testing Library.

Versions are pinned to proven majors on purpose, not the newest ones.

## Request flow

```
Browser page (client component)
  └─ api.get/post/... (src/lib/api-client.ts)     fetch('/api/…'), visible in the Network tab
      └─ Route Handler (src/app/api/**/route.ts)  requireActor(permission) → readBody(zodSchema)
          └─ Service (src/server/services/*.ts)   business rules, assertCan(), one DB transaction
              └─ Drizzle → PostgreSQL               constraints are the last line of defence
```

Pages fetch with TanStack Query and call `useRefreshData()` after a successful write, so every list refreshes.
Server layouts read the session cookie and redirect before anything renders (`src/server/auth/entry.ts`).

## Folder layout

```
src/
  app/                    Routes only (Next.js App Router)
    layout.tsx            Root layout: metadata, theme script, client Providers
    page.tsx              "/" redirects to setup, login or /dashboard
    (auth)/login, setup   Public pages; redirect away when they don't apply
    (dashboard)/          Signed-in pages; layout.tsx verifies the session on the server
      products/[id], products/[id]/edit, …
      [module]/           "Not built yet" pages for later-phase modules
      error.tsx           Error boundary; the sidebar stays usable
    api/                  JSON API (Route Handlers)
  server/                 Server-only code (imports 'server-only')
    db/schema.ts          Drizzle schema = source of truth for tables
    db/index.ts           Connection: DATABASE_URL → postgres.js, else PGlite
    auth/                 Cookie sessions, page redirects
    services/             Business logic per module (auth, settings, catalog, product, product-csv, audit, counter)
    http.ts               Route Handler wrapper: auth, body parsing, one error format
  components/
    ui/                   shadcn/ui primitives
    layout/               Providers, app shell, sidebar, top bar
    shared/               Reusable app components (page header, states, dialogs, barcode, print)
    <module>/             Page components per module
  lib/                    Shared by browser and server: money/decimal math, units, barcodes, CSV, dates,
                          permissions, validation schemas (product.ts, catalog.ts), API client
  hooks/                  React hooks (session, settings, catalog, permissions, online status)
  constants/              Sidebar navigation, route permissions, URL helpers
  types/                  Domain entity types (db.ts)
  stores/                 Zustand: theme
drizzle/                  Generated SQL migrations (commit them)
tests/                    Vitest: lib, services, API routes, UI (all on in-memory Postgres)
```

File names are kebab-case (`product.ts`, `products-page.tsx`), the usual Next.js/shadcn convention.

## API conventions

- Every route is wrapped in `route()` (`src/server/http.ts`). Errors are `{ error: { code, message, issues? } }` with
  401 (not signed in), 403 (role), 404, 409 (duplicate / unique violation), 400 (validation) or 500.
- `requireActor(...permissions)` loads the session user and checks the role. Services check again with `assertCan`,
  so a service can never be called without a permission check.
- Input is validated with the same Zod schema the form uses (`src/lib/product.ts`, `src/lib/catalog.ts`).
- Cost data (purchase prices, stock value) is removed from responses for roles without `products.view_cost`.

## Auth

First run: `/setup` creates the owner account and shop details (`POST /api/setup`, refused once any user exists).
After that, `/login` (`POST /api/auth/login`). A session is a random 32-byte token in an httpOnly, SameSite=Lax
cookie (`pos_session`, 12 hours); the `sessions` table stores only its SHA-256. PINs are PBKDF2-SHA256 with a
per-user salt. Logout deletes the session row.

## Core rules

**Money.** Stored as integer **poisha** (`৳1 = 100`), BIGINT in Postgres. Parsing, multiplication and percentages
use BigInt-backed exact helpers (`lib/decimal.ts`, `lib/money.ts`). Floats are never used for totals. `allocate()`
splits invoice discounts and extra costs across lines so the parts sum exactly.

**Quantities.** Every product has one base unit, and the smallest practical one is chosen (piece, gram, ml).
Stock is an **integer in base units**. Every other unit has an integer `factor` (base units per unit; 1 Sack = 25000).
A user quantity such as `1.5` KG converts exactly (`mulToInteger('1.5', 1000, 'exact') = 1500`). If a quantity
does not convert to a whole number of base units, it is rejected rather than rounded.

**Unit prices are independent.** Each product unit carries its own retail, wholesale and purchase price. A packet
price is not derived from the piece price.

**Costing.** Weighted average. Each product caches `stockQty` and `stockValue` (total poisha).
COGS for a sale is `stockValue × qty / stockQty`. Storing the total instead of a per-unit average avoids precision
loss for gram-level units. The batch table keeps the design open to FIFO later.

**Atomicity.** Any operation that touches several tables runs inside one `db.transaction(async (tx) => …)` and
passes `tx` to every helper and to `writeAudit`. If anything throws, Postgres rolls back every write. Rows that two
requests could change at once are locked with `SELECT … FOR UPDATE` (see `updateProduct`).

**Append-only history.** Stock changes always write a `stock_movements` row. Money changes (later phases) always
write payments, cash transactions and balanced double-entry ledger lines. Completed records are never deleted;
cancellations write reversal entries.

**Snapshots.** Sale, purchase and return items copy the product name, unit name, factor, price and cost at that
moment. Editing a product never changes past invoices.

**Duplicate prevention.** Each submission will carry a client `idempotencyKey` with a unique index, so a
double-click or retry gets 409 instead of a second sale.

**Dates.** Stored as TIMESTAMPTZ, handled as epoch ms in the app. "Today" and day boundaries are computed in the
shop timezone (Asia/Dhaka). Expiry dates are `DATE`. A product with no expiry uses `9999-12-31`, so FEFO ordering
works on one index.

**Actors.** Services take the database and an explicit `Actor` (`{ id, name, role }`) instead of reading global
state. This keeps them testable.

## Catalog (Phase 2)

**Unit engine** (`lib/units.ts`). Pure functions: `toBaseQty` (user quantity in a unit to integer base units; rejects
zero, negatives, fractions on whole-unit products and anything finer than one base unit), `fromBaseQty`,
`breakdown`/`formatBreakdown` ("1 Carton + 8 Packet + 4 Piece") and factor validation. Later phases (purchase, POS,
returns) must convert quantities through this module, never with their own arithmetic.

**Defining units.** In the product form each non-base unit is entered relative to an earlier unit
("1 Carton = 24 × Packet"), and the form stores the resulting base factor (288). Only the base factor is persisted.
Once a product has stock or any history, its base unit can be renamed but not replaced (`productHasHistory`).
The database also enforces exactly one base unit and unique unit names per product.

**Prices per unit.** A price that is not a whole poisha per base unit (৳78/KG is 7.8 poisha per gram) cannot be
stored on the gram row. That is the reason KG and Sack carry their own prices: sell in the unit whose price you set.

**Products are archived, not deleted.** `DELETE /api/products/:id` only succeeds for products with no stock,
movements or batches. Anything else is archived. Categories and brands are always archived, never deleted.

**Barcodes.** Unique across all products. A barcode may point at a unit, so scanning a carton code selects Carton.
Generated codes are EAN-13 with prefix `2` (reserved for in-store use, so no clash with manufacturer codes).
`lib/barcode.ts` encodes EAN-13 and Code 128 to SVG with no extra dependency. Labels print through `PrintPortal`,
which hides the app while printing and sets `@page` for the label size.

**Price permissions.** Editing products needs `products.edit`, and any price change also needs
`products.edit_price` (every change is audit-logged as `product.price_change`).

**CSV** (`lib/product-csv.ts` parses, `server/services/product-csv.ts` imports/exports). One row per unit, grouped by
SKU. The import dialog checks the file in the browser first; `POST /api/products/import` validates again and writes
nothing if any row is wrong. It then inserts every new product in one transaction, skips existing SKUs (never
overwrites) and creates missing categories and brands by name. Exports carry a UTF-8 BOM (Excel) and guard against
spreadsheet formula injection.

## Inventory and purchases (Phase 3)

**Stock changes only in `server/services/inventory.ts`.** `stockIn` and `stockOut` lock the product row
(`FOR UPDATE`), update the cached `stock_qty` / `stock_value` and write a `stock_movements` row in the caller's
transaction, so the movement history always sums to the stock (a test checks it).

- **Valuation:** weighted-average cost. `stock_value` is the total cost on hand; stock out removes
  `stock_value × qty / stock_qty` (integer, rounded to the poisha). Reversals (cancelling a purchase) remove the exact
  value they added.
- **Batches:** for products with batch tracking, stock in creates a batch (number auto-generated when blank; expiry
  required when expiry tracking is on). Stock out takes from the earliest expiry first (FEFO); stock from before batch
  tracking was turned on is used last. A write-off can name one batch.
- **Negative stock:** adjustments and purchase cancellations never go below zero. `allowNegative` exists for sales
  (Phase 4, from the `allowNegativeStock` setting).
- **Adjustments** (`POST /api/inventory/adjust`): opening stock, corrections (+/−), damaged, lost, expired. A reason is
  required except for opening stock. Each one is audited.
- **Purchases** (`services/purchase.ts`): one transaction saves the purchase, its line snapshots, stock in per line
  (at landed cost: the invoice discount and extra costs are spread over lines with `allocate()`), the unit's latest
  purchase price, and the supplier's payable. `idempotencyKey` (one per form) makes retries safe. A due needs a
  supplier. Cancelling takes the stock back out of the same batches and removes the due; it is refused once any of
  that stock was sold or written off.
- **Suppliers** are minimal for now (name, contact, payable); payments and the ledger come in Phase 5.

## Languages (English / বাংলা)

`next-intl`, without URL prefixes: the chosen language lives in the `NEXT_LOCALE` cookie, set by the language
menu (`components/layout/language-switcher.tsx`). The server reads it in `src/i18n/request.ts`, so the first render
is already in the right language and `<html lang>` matches.

- **Messages:** `messages/en.json` and `messages/bn.json` must have the same keys and placeholders (a test checks
  this). Use ICU syntax for counts: `{count, plural, one {# item} other {# items}}`.
- **Components:** `const t = useTranslations('namespace')`. Never hard-code user-visible English in JSX.
- **Validation:** Zod schemas shared by forms and APIs use keys, not sentences: `.min(1, 'v.nameRequired')`, with values
  via `params` for custom issues. `translateMessage()` (`src/i18n/translate.ts`) turns them into `validation.*` text;
  `FormMessage` does it automatically.
- **API errors:** throw `new BusinessError(code, englishMessage, { key?, values? })`. `route()` translates
  `errors.<key ?? code>` into the request's language (`src/server/i18n.ts`), falling back to the English message.
- **Not translated:** data the user types (product, unit, category names) and numbers/prices, which keep English
  digits (`৳1,250.50`) to match barcodes, receipts and keyboard input.

## Modules from later phases

`app/(dashboard)/[module]` renders a "not built yet" page for each sidebar entry that has no folder of its own.
When a module is implemented, give it its own route folder and add its path to `BUILT` in that file.
