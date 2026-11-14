import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseFormPage } from '@/components/purchases/purchase-form-page'
import { SessionProvider, type SessionUser } from '@/hooks/use-session'
import { newId } from '@/lib/id'
import { getDb } from '@/server/db'
import { products, purchases } from '@/server/db/schema'
import en from '../../../messages/en.json'
import { apiJson, mockFetchToApi } from '../../helpers/api'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}))

let user: SessionUser
let fetchSpy: ReturnType<typeof mockFetchToApi>
let riceId: string

beforeEach(async () => {
  push.mockClear()
  fetchSpy = mockFetchToApi()
  user = (await apiJson<{ user: SessionUser }>('POST', '/api/setup', { shopName: 'Shop', name: 'Karim', username: 'owner', pin: '2468' })).body.user
  const rice = await apiJson<{ id: string }>('POST', '/api/products', {
    name: 'Miniket Rice',
    allowFraction: true,
    minStockQty: 0,
    taxRate: 0,
    trackBatches: false,
    trackExpiry: false,
    units: [
      { id: newId(), name: 'Gram', factor: 1, isBase: true, canPurchase: false, canSell: false, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0 },
      { id: newId(), name: 'KG', factor: 1000, isBase: false, canPurchase: true, canSell: true, retailPrice: 7800, wholesalePrice: 0, purchasePrice: 7000 },
      { id: newId(), name: 'Sack', factor: 25_000, isBase: false, canPurchase: true, canSell: true, retailPrice: 0, wholesalePrice: 0, purchasePrice: 180_000 },
    ],
    barcodes: [],
  })
  riceId = rice.body.id
})

afterEach(() => fetchSpy.mockRestore())

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Dhaka">
      <QueryClientProvider client={client}>
        <SessionProvider user={user}>
          <PurchaseFormPage />
        </SessionProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('PurchaseFormPage', () => {
  it('buys 5 sacks of rice paid in full: stock goes up by 125 KG', async () => {
    const u = userEvent.setup()
    renderForm()
    await u.click(await screen.findByRole('combobox', { name: /Add product/ }))
    await u.click(await screen.findByRole('option', { name: /Miniket Rice/ }))

    // The sack is picked by default with its last cost (৳1800).
    const qty = screen.getByLabelText('Quantity')
    await u.clear(qty)
    await u.type(qty, '5')
    expect(screen.getByText('Adds 5 Sack to stock')).toBeInTheDocument()
    expect(screen.getByLabelText('Cost per Sack (৳)')).toHaveValue('1800')
    // Line amount, subtotal and total; "Paid now" follows the total.
    expect(screen.getAllByText('৳9,000.00')).toHaveLength(3)
    expect(screen.getByLabelText('Paid now')).toHaveValue('9000')

    await u.click(screen.getByRole('button', { name: /Save purchase/ }))
    await vi.waitFor(() => expect(push).toHaveBeenCalled())
    const db = await getDb()
    const [p] = await db.select().from(purchases)
    expect(p).toMatchObject({ total: 900_000, paid: 900_000, due: 0 })
    expect(push).toHaveBeenCalledWith(`/purchases/${p.id}`)
    const [rice] = await db.select().from(products).where(eq(products.id, riceId))
    expect(rice.stockQty).toBe(125_000)
  })

  it('refuses a due without a supplier before calling the server', async () => {
    const u = userEvent.setup()
    renderForm()
    await u.click(await screen.findByRole('combobox', { name: /Add product/ }))
    await u.click(await screen.findByRole('option', { name: /Miniket Rice/ }))
    await u.click(screen.getByRole('button', { name: 'Nothing' }))
    await u.click(screen.getByRole('button', { name: /Save purchase/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a supplier to keep a due')
    expect(await (await getDb()).select().from(purchases)).toHaveLength(0)
  })
})
