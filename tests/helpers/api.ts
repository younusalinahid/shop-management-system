import { vi } from 'vitest'

/**
 * Calls the app's real Route Handlers in-process (no HTTP server). Cookies set by a handler are kept
 * in the mocked next/headers jar from tests/setup.ts, so a login carries over to later calls.
 */

// ctx is typed per route ({ params: Promise<{ id }> }); `never` accepts every handler signature.
type Handler = (req: Request, ctx: never) => Promise<Response>
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>

const ROUTES: Array<[RegExp, () => Promise<RouteModule>]> = [
  [/^\/api\/setup$/, () => import('@/app/api/setup/route')],
  [/^\/api\/auth\/login$/, () => import('@/app/api/auth/login/route')],
  [/^\/api\/auth\/logout$/, () => import('@/app/api/auth/logout/route')],
  [/^\/api\/auth\/me$/, () => import('@/app/api/auth/me/route')],
  [/^\/api\/auth\/users$/, () => import('@/app/api/auth/users/route')],
  [/^\/api\/settings$/, () => import('@/app/api/settings/route')],
  [/^\/api\/dashboard$/, () => import('@/app/api/dashboard/route')],
  [/^\/api\/categories$/, () => import('@/app/api/categories/route')],
  [/^\/api\/categories\/(?<id>[^/]+)$/, () => import('@/app/api/categories/[id]/route')],
  [/^\/api\/brands$/, () => import('@/app/api/brands/route')],
  [/^\/api\/brands\/(?<id>[^/]+)$/, () => import('@/app/api/brands/[id]/route')],
  [/^\/api\/products$/, () => import('@/app/api/products/route')],
  [/^\/api\/products\/bulk-price$/, () => import('@/app/api/products/bulk-price/route')],
  [/^\/api\/products\/export$/, () => import('@/app/api/products/export/route')],
  [/^\/api\/products\/import$/, () => import('@/app/api/products/import/route')],
  [/^\/api\/products\/(?<id>[^/]+)$/, () => import('@/app/api/products/[id]/route')],
  [/^\/api\/barcodes\/generate$/, () => import('@/app/api/barcodes/generate/route')],
  [/^\/api\/barcodes\/assign$/, () => import('@/app/api/barcodes/assign/route')],
  [/^\/api\/barcodes\/lookup$/, () => import('@/app/api/barcodes/lookup/route')],
  [/^\/api\/inventory\/adjust$/, () => import('@/app/api/inventory/adjust/route')],
  [/^\/api\/inventory\/movements$/, () => import('@/app/api/inventory/movements/route')],
  [/^\/api\/inventory\/batches$/, () => import('@/app/api/inventory/batches/route')],
  [/^\/api\/suppliers$/, () => import('@/app/api/suppliers/route')],
  [/^\/api\/suppliers\/(?<id>[^/]+)$/, () => import('@/app/api/suppliers/[id]/route')],
  [/^\/api\/purchases$/, () => import('@/app/api/purchases/route')],
  [/^\/api\/purchases\/(?<id>[^/]+)\/cancel$/, () => import('@/app/api/purchases/[id]/cancel/route')],
  [/^\/api\/purchases\/(?<id>[^/]+)$/, () => import('@/app/api/purchases/[id]/route')],
  [/^\/api\/sales$/, () => import('@/app/api/sales/route')],
  [/^\/api\/sales\/(?<id>[^/]+)\/cancel$/, () => import('@/app/api/sales/[id]/cancel/route')],
  [/^\/api\/sales\/(?<id>[^/]+)$/, () => import('@/app/api/sales/[id]/route')],
  [/^\/api\/held-sales$/, () => import('@/app/api/held-sales/route')],
  [/^\/api\/held-sales\/(?<id>[^/]+)$/, () => import('@/app/api/held-sales/[id]/route')],
  [/^\/api\/customers$/, () => import('@/app/api/customers/route')],
  [/^\/api\/customers\/(?<id>[^/]+)$/, () => import('@/app/api/customers/[id]/route')],
  [/^\/api\/payments$/, () => import('@/app/api/payments/route')],
  [/^\/api\/payments\/collect$/, () => import('@/app/api/payments/collect/route')],
  [/^\/api\/payments\/supplier$/, () => import('@/app/api/payments/supplier/route')],
  [/^\/api\/payments\/(?<id>[^/]+)\/void$/, () => import('@/app/api/payments/[id]/void/route')],
  [/^\/api\/sale-returns$/, () => import('@/app/api/sale-returns/route')],
  [/^\/api\/purchase-returns$/, () => import('@/app/api/purchase-returns/route')],
  [/^\/api\/expenses$/, () => import('@/app/api/expenses/route')],
  [/^\/api\/expenses\/(?<id>[^/]+)\/void$/, () => import('@/app/api/expenses/[id]/void/route')],
  [/^\/api\/cash$/, () => import('@/app/api/cash/route')],
  [/^\/api\/cash\/movements$/, () => import('@/app/api/cash/movements/route')],
  [/^\/api\/shifts$/, () => import('@/app/api/shifts/route')],
  [/^\/api\/shifts\/(?<id>[^/]+)\/close$/, () => import('@/app/api/shifts/[id]/close/route')],
  [/^\/api\/reports\/profit$/, () => import('@/app/api/reports/profit/route')],
]

export async function callApi(method: string, path: string, body?: unknown): Promise<Response> {
  const url = new URL(path, 'http://localhost')
  for (const [re, load] of ROUTES) {
    const m = re.exec(url.pathname)
    if (!m) continue
    const handler = (await load())[method as keyof RouteModule]
    if (!handler) return new Response(null, { status: 405 })
    const req = new Request(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return handler(req, { params: Promise.resolve({ ...m.groups }) } as never)
  }
  return new Response(JSON.stringify({ error: { code: 'not_found', message: `No route for ${path}` } }), { status: 404 })
}

/** JSON helper: returns { status, body }. */
export async function apiJson<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await callApi(method, path, body)
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

/** Route the browser's fetch('/api/...') to the handlers, for component tests. */
export function mockFetchToApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const body = typeof init?.body === 'string' ? init.body : undefined
    return callApi(init?.method ?? 'GET', path, body)
  })
}
