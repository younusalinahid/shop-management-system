# Architecture

## Stack

Next.js 16 (App Router, `output: 'export'`) · React 19 · TypeScript 5.9 · Tailwind CSS 4 + shadcn/ui (Radix) · Lucide · Dexie 4 (IndexedDB) ·
Zustand · React Hook Form + Zod · Recharts · Workbox (generated after build) · Vitest + RTL + fake-indexeddb.

Versions are pinned to proven majors on purpose, not the newest ones.

## Folder layout

Standard Next.js layout with a `src/` folder: routes live in `src/app/`, everything else beside it.

```
src/
  app/                    Routes only (Next.js App Router)
    layout.tsx            Root layout: metadata, theme script, AppBoot
    page.tsx              "/" redirects to /dashboard
    not-found.tsx         404 page
    (dashboard)/          Route group for signed-in pages (no URL segment)
      layout.tsx          App shell + route permission check
      error.tsx           Error boundary; the sidebar stays usable
      dashboard/ products/ categories/ brands/ barcodes/ settings/   One page.tsx each
      [module]/           "Not built yet" pages for later-phase modules
  components/
    ui/                   shadcn/ui primitives (generated; edit sparingly)
    layout/               AppBoot, app shell, sidebar, top bar
    shared/               Reusable app components (page header, states, dialogs, barcode, print)
    <module>/             Page components per module (products, catalog, barcodes, …)
  constants/              Sidebar navigation, route permissions, URL helpers
  db/                     Dexie database, migrations (schema), default-data bootstrap
  types/                  Entity types (db.ts)
  hooks/                  React hooks (live settings, catalog, permissions, online status)
  lib/                    Pure helpers: exact money/decimal math, units, barcodes, CSV, dates, permissions
  services/               Business logic. UI never writes to the DB directly for business operations.
  stores/                 Zustand: session and theme only
tests/                    Vitest suites mirroring src/ (+ setup.ts with fake-indexeddb)
scripts/generate-sw.mjs   Builds the offline service worker after `next build`
public/                   Icons and manifest.webmanifest
```

File names are kebab-case (`product-service.ts`), the usual Next.js/shadcn convention.

## Core rules

**Money.** Stored as integer **poisha** (`৳1 = 100`). Parsing, multiplication and percentages use BigInt-backed
exact helpers (`lib/decimal.ts`, `lib/money.ts`). Floats are never used for totals. `allocate()` splits invoice
discounts and extra costs across lines so the parts sum exactly.

**Quantities.** Every product has one base unit, and the smallest practical one is chosen (piece, gram, ml).
Stock is an **integer in base units**. Every other unit has an integer `factor` (base units per unit; 1 Sack = 25000).
A user quantity such as `1.5` KG converts exactly (`mulToInteger('1.5', 1000, 'exact') = 1500`). If a quantity
does not convert to a whole number of base units, it is rejected rather than rounded.

**Unit prices are independent.** Each product unit carries its own retail, wholesale and purchase price. A packet
price is not derived from the piece price.

**Costing.** Weighted average. Each product caches `stockQty` and `stockValue` (total poisha).
COGS for a sale is `stockValue × qty / stockQty`. Storing the total instead of a per-unit average avoids precision
loss for gram-level units. The batch table keeps the design open to FIFO later.

**Atomicity.** Any operation that touches several tables (sale, purchase, return, payment, adjustment) runs inside
one `db.transaction('rw', …)`. If anything throws, IndexedDB rolls back every write. Inside a transaction, never
`await` non-IndexedDB async work (fetch, crypto.subtle, timers): do it before the transaction starts.

**Append-only history.** Stock changes always write a `stockMovements` row. Money changes always write `payments`,
`cashTransactions` and balanced double-entry `financialLedger` lines. Completed records are never deleted.
Cancellations write reversal entries instead.

**Snapshots.** Sale, purchase and return items copy the product name, unit name, factor, price and cost at that
moment. Editing a product never changes past invoices.

**Duplicate prevention.** Each submission carries a client `idempotencyKey`, and the key has a unique index.
A double-click or retry fails with `ConstraintError` instead of creating a second sale.

**Dates.** Stored as epoch ms. "Today" and day boundaries are computed in the shop timezone (Asia/Dhaka)
regardless of device timezone. Expiry dates are `YYYY-MM-DD` strings. A product with no expiry uses `9999-12-31`,
so FEFO ordering works on a single compound index.

**Actors.** Services take an explicit `Actor` (`{ id, name }`) for audit records instead of reading global state.
This keeps them testable.

## Catalog (Phase 2)

**Unit engine** (`lib/units.ts`). Pure functions: `toBaseQty` (user quantity in a unit to integer base units; rejects
zero, negatives, fractions on whole-unit products and anything finer than one base unit), `fromBaseQty`,
`breakdown`/`formatBreakdown` ("1 Carton + 8 Packet + 4 Piece") and factor validation. Later phases (purchase, POS,
returns) must convert quantities through this module, never with their own arithmetic.

**Defining units.** In the product form each non-base unit is entered relative to an earlier unit
("1 Carton = 24 × Packet"), and the form stores the resulting base factor (288). Only the base factor is persisted.
Once a product has stock or any history, its base unit can be renamed but not replaced (`productHasHistory`).

**Prices per unit.** A price that is not a whole poisha per base unit (৳78/KG is 7.8 poisha per gram) cannot be
stored on the gram row. That is the reason KG and Sack carry their own prices: sell in the unit whose price you set.

**Products are archived, not deleted.** `deleteProduct` only succeeds for products with no stock, movements,
batches or document lines. Anything else is archived. Categories and brands are always archived, never deleted.

**Barcodes.** Unique across all products (`&code`). A barcode may point at a unit, so scanning a carton code selects
Carton. Generated codes are EAN-13 with prefix `2` (reserved for in-store use, so no clash with manufacturer codes).
`lib/barcode.ts` encodes EAN-13 and Code 128 to SVG with no extra dependency. Labels print through `PrintPortal`,
which hides the app while printing and sets `@page` for the label size.

**Permissions in services.** `requirePermission(actor, …)` reloads the user and re-checks the role. Editing products
needs `products.edit`, and any price change also needs `products.edit_price` (every change is audit-logged as
`product.price_change`). Purchase prices are hidden from roles without `products.view_cost`, including in CSV
exports.

**CSV** (`services/product-csv-service.ts`). One row per unit, grouped by SKU. Import validates the whole file first
and writes nothing if any row is wrong. It then inserts every new product in one transaction, skips existing SKUs
(never overwrites) and creates missing categories and brands by name. Exports carry a UTF-8 BOM (Excel) and guard
against spreadsheet formula injection.

**Dexie gotcha.** A `db.transaction(..., scope)` callback must be an `async` function when the work inside awaits
native promises (e.g. calls another `async` helper). A plain arrow that returns a promise lets the transaction commit
early (`PrematureCommitError`).

## Next.js without a server

The app uses Next.js purely as a client-side React framework and exports static HTML (`out/`).

- **No server features.** No API routes, Server Actions, middleware or dynamic rendering, and `output: 'export'`
  rejects them at build time. All business data stays in IndexedDB.
- **`AppBoot`** (client component in the root layout) opens the database, then shows setup, login or the page.
  During the build prerender it only renders a loading state, so no page touches IndexedDB on the server.
- **Client components.** Every page component that uses Dexie, Zustand or browser APIs starts with `'use client'`.
  Route files under `app/` stay thin server components that render them.
- **No `/products/[id]`.** Static export must know every dynamic path at build time, but record ids are created in
  the browser. Detail and edit pages use query strings (`/products/view?id=…`, built with `productUrl()`), read
  with `useSearchParams` inside a `<Suspense>` boundary.
- **Modules from later phases** are served by `app/(dashboard)/[module]`, which pre-renders one "not built yet" page
  per sidebar entry. When a module is implemented, give it its own folder and add its path to `BUILT` in that file.
  (In dev, a mistyped single-segment URL logs a "missing param" error from this route; it still returns 404.)
- **Route permissions** are checked in `app/(dashboard)/layout.tsx` via `routePermission()`. Services re-check them.

## Offline / PWA

`scripts/generate-sw.mjs` runs after `next build` and writes `out/sw.js` with Workbox. It precaches every exported
page, RSC payload and asset, maps `/products` to `products.html`, and ignores query strings, so
`/products/view?id=…` works offline. `ReloadPrompt` registers it in production builds only. Updates use **prompt mode**:
the user chooses when to reload, so an update never interrupts a sale. All data is local, so being offline changes
nothing functionally.

## Auth

On first run the app asks for the shop details and creates an owner account. After that, users sign in with a PIN.
The session lives in `sessionStorage`, so closing the app requires the PIN again. Permissions are defined in
`lib/permissions.ts`; routes and navigation are filtered by role. See the README for the security limitations.
