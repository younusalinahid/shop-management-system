# Shop Management System (POS)

Point of Sale and shop management for retail and wholesale shops in Bangladesh.
Built with Next.js (App Router, static export) and TypeScript. It runs entirely in the browser, with no server and no
cloud database. Data lives in IndexedDB on the device.
After the first load it works fully offline, and you can install it as a PWA.

## Requirements

- **Node.js 20 or newer** (developed with 22.x). With nvm-windows: `nvm use 22.23.2`.

## Scripts

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Next.js dev server on http://localhost:5173 (no service worker in dev) |
| `npm run build`     | Type-check, static export into `out/`, then generate the offline service worker |
| `npm start`         | Serve `out/` on http://localhost:5173 (PWA and offline mode active) |
| `npm test`          | Run the test suite once (Vitest + fake-indexeddb) |
| `npm run typecheck` | TypeScript only                                 |

Deploy the static `out/` folder to Vercel, Netlify or GitHub Pages. Pages are exported as `products.html` etc.;
these hosts serve `/products` from it automatically. No SPA rewrite rule is needed.

Port 5173 is used for both dev and preview on purpose: IndexedDB is tied to the origin (host + port), so changing
the port would show an empty shop.

## ⚠ Data safety — read this

- All data is stored **only in this browser on this device**.
- Clearing browser/site data, uninstalling the browser, using a private window, or a device failure **can permanently erase everything**.
- The app asks the browser for *persistent storage*. The browser may refuse, and even when it agrees, this does not guarantee the data survives.
- **Export a JSON backup regularly** (Backup & Restore, Phase 8) and keep copies off the device.

## ⚠ Security limitations

- User PINs are hashed (PBKDF2-SHA256) but are checked **locally**. Anyone with access to the device and browser dev tools can read or change the database.
- Role permissions and audit logs help keep counter work orderly. They are **not** tamper-proof security records and do not replace server-side authentication.

## Docs

- [Architecture](docs/ARCHITECTURE.md): stack, folder layout, core rules (money, quantities, transactions)
- [Database](docs/DATABASE.md): tables, indexes, migration process
