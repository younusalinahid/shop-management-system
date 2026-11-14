import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductFormPage } from '@/components/products/product-form-page'
import { SessionProvider, type SessionUser } from '@/hooks/use-session'
import { getDb } from '@/server/db'
import { products, productUnits } from '@/server/db/schema'
import en from '../../../messages/en.json'
import { apiJson, mockFetchToApi } from '../../helpers/api'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}))

let user: SessionUser
let fetchSpy: ReturnType<typeof mockFetchToApi>

beforeEach(async () => {
  push.mockClear()
  // Real API in-process: setup signs the owner in (cookie jar from tests/setup.ts).
  fetchSpy = mockFetchToApi()
  user = (await apiJson<{ user: SessionUser }>('POST', '/api/setup', { shopName: 'Shop', name: 'Karim', username: 'owner', pin: '2468' })).body.user
})

afterEach(() => fetchSpy.mockRestore())

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Dhaka">
      <QueryClientProvider client={client}>
        <SessionProvider user={user}>
          <ProductFormPage />
        </SessionProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

const allProducts = async () => (await getDb()).select().from(products)
const unitsOf = async (productId: string) =>
  (await getDb()).select().from(productUnits).where(eq(productUnits.productId, productId)).orderBy(asc(productUnits.sortOrder))

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await vi.waitFor(() => expect(push).toHaveBeenCalled())
  const [p] = await allProducts()
  expect(push).toHaveBeenCalledWith(`/products/${p.id}`)
  return p
}

describe('ProductFormPage', () => {
  it('rice "by weight": sold in KG and by the 25 KG sack, counted in grams', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByPlaceholderText('e.g. Miniket Rice'), 'Miniket Rice')
    await user.click(screen.getByRole('radio', { name: /By weight/ }))
    await user.type(screen.getByLabelText('Also sold by the sack? KG in 1 sack'), '25')
    expect(await screen.findByText('= 25,000 Gram')).toBeInTheDocument()

    // Price rows appear only for units that are sold: KG and Sack (not grams).
    const selling = screen.getAllByLabelText('Selling price')
    expect(selling).toHaveLength(2)
    await user.type(selling[0], '78')
    await user.type(selling[1], '1900')

    const p = await save(user)
    expect(p).toMatchObject({ name: 'Miniket Rice', baseUnitName: 'Gram', allowFraction: true, stockQty: 0 })
    expect((await unitsOf(p.id)).map((u) => [u.name, u.factor, u.canSell, u.retailPrice])).toEqual([
      ['Gram', 1, false, 0],
      ['KG', 1000, true, 7800],
      ['Sack', 25_000, true, 190_000],
    ])
  })

  it('chocolate "piece and packet": 35 pieces per packet with its own price', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByPlaceholderText('e.g. Miniket Rice'), '1 Taka Chocolate')
    await user.click(screen.getByRole('radio', { name: /Piece and packet/ }))
    await user.type(screen.getByLabelText('How many pieces in 1 Packet?'), '35')
    const selling = screen.getAllByLabelText('Selling price')
    await user.type(selling[0], '1')
    await user.type(selling[1], '33')

    const p = await save(user)
    expect(p).toMatchObject({ baseUnitName: 'Piece', allowFraction: false })
    expect((await unitsOf(p.id)).map((u) => [u.name, u.factor, u.retailPrice])).toEqual([
      ['Piece', 1, 100],
      ['Packet', 35, 3300],
    ])
  })

  it('shows plain errors next to the question instead of saving', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByRole('radio', { name: /Piece and packet/ }))
    await user.type(screen.getByLabelText('How many pieces in 1 Packet?'), '0.5')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(await screen.findByText('Product name is required')).toBeInTheDocument()
    expect(screen.getByText(/Must come to a whole number of Piece/)).toBeInTheDocument()
    expect(await allProducts()).toHaveLength(0)
  })

  it('keeps the full unit editor under "Custom"', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByRole('radio', { name: /Custom/ }))
    expect(screen.getByRole('button', { name: /Add package unit/ })).toBeInTheDocument()
  })
})
