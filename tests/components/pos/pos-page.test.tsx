import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosPage } from '@/components/pos/pos-page'
import { SessionProvider, type SessionUser } from '@/hooks/use-session'
import { settingsQuery } from '@/hooks/use-settings'
import { newId } from '@/lib/id'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { getDb } from '@/server/db'
import { products, sales } from '@/server/db/schema'
import en from '../../../messages/en.json'
import { apiJson, mockFetchToApi } from '../../helpers/api'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))

let user: SessionUser
let fetchSpy: ReturnType<typeof mockFetchToApi>
let chocolateId: string

beforeEach(async () => {
  fetchSpy = mockFetchToApi()
  user = (await apiJson<{ user: SessionUser }>('POST', '/api/setup', { shopName: 'Rahman Store', name: 'Karim', username: 'owner', pin: '2468' })).body.user
  const units = [
    { id: newId(), name: 'Piece', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 100, wholesalePrice: 0, purchasePrice: 80 },
    { id: newId(), name: 'Packet', factor: 35, isBase: false, canPurchase: true, canSell: true, retailPrice: 3300, wholesalePrice: 3000, purchasePrice: 2700 },
  ]
  const choc = await apiJson<{ id: string }>('POST', '/api/products', {
    name: '1 Taka Chocolate',
    allowFraction: false,
    minStockQty: 0,
    taxRate: 0,
    trackBatches: false,
    trackExpiry: false,
    units,
    barcodes: [{ code: '8941100500017', unitId: units[1].id }],
  })
  chocolateId = choc.body.id
  await apiJson('POST', '/api/inventory/adjust', { productId: chocolateId, type: 'opening', unitId: units[1].id, quantity: '10' })
})

afterEach(() => fetchSpy.mockRestore())

function renderPos() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(settingsQuery.queryKey, { ...DEFAULT_SETTINGS, shopName: 'Rahman Store', updatedAt: 0 })
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Dhaka">
      <QueryClientProvider client={client}>
        <SessionProvider user={user}>
          <PosPage />
        </SessionProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('PosPage', () => {
  it('scans a packet barcode, adds a second packet, takes cash with change and shows the receipt', async () => {
    const u = userEvent.setup()
    renderPos()
    const search = await screen.findByRole('textbox', { name: 'Search or scan product' })
    // The scanner types the packet barcode and Enter: one Packet is added.
    await u.type(search, '8941100500017{Enter}')
    expect(await screen.findByRole('combobox', { name: 'Unit of 1 Taka Chocolate' })).toHaveTextContent('Packet')
    await u.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(screen.getByRole('textbox', { name: 'Quantity of 1 Taka Chocolate' })).toHaveValue('2')

    await u.click(screen.getByRole('button', { name: /^Pay/ }))
    const amount = await screen.findByRole('textbox', { name: 'Amount by Cash' })
    await u.clear(amount)
    await u.type(amount, '100')
    expect(screen.getByText('Change to give').nextSibling).toHaveTextContent('৳34.00')
    await u.click(screen.getByRole('button', { name: 'Complete sale' }))

    expect(await screen.findByText('Sale INV-000001 completed')).toBeInTheDocument()
    expect(screen.getByText('Give back ৳34.00 change.')).toBeInTheDocument()
    const db = await getDb()
    expect((await db.select().from(sales))[0]).toMatchObject({ total: 6600, paid: 6600, changeGiven: 3400 })
    expect((await db.select().from(products).where(eq(products.id, chocolateId)))[0].stockQty).toBe(280)
  })

  it('will not complete a due sale without a customer', async () => {
    const u = userEvent.setup()
    renderPos()
    await u.type(await screen.findByRole('textbox', { name: 'Search or scan product' }), '8941100500017{Enter}')
    await u.click(await screen.findByRole('button', { name: /^Pay/ }))
    await u.click(await screen.findByRole('button', { name: 'Nothing (due)' }))
    await u.click(screen.getByRole('button', { name: 'Complete sale' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a customer to sell on due.')
    expect(await (await getDb()).select().from(sales)).toHaveLength(0)
  })
})
