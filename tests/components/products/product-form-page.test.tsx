import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDefaults } from '@/db/bootstrap'
import { db } from '@/db/database'
import { createInitialOwner } from '@/services/auth-service'
import { useSession } from '@/stores/session-store'
import { ProductFormPage } from '@/components/products/product-form-page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(async () => {
  push.mockClear()
  await ensureDefaults()
  const owner = await createInitialOwner({ name: 'Karim', username: 'owner', pin: '2468' })
  useSession.getState().signIn(owner)
})

function renderForm() {
  return render(<ProductFormPage />)
}

describe('ProductFormPage', () => {
  it('creates rice sold by Gram, KG and Sack, with the sack defined as 25 KG', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByPlaceholderText('e.g. Miniket Rice'), 'Miniket Rice')

    const nameInputs = () => screen.getAllByPlaceholderText(/Piece, Gram|Packet, KG/)
    await user.clear(nameInputs()[0])
    await user.type(nameInputs()[0], 'Gram')
    await user.click(screen.getByRole('button', { name: /KG \(= 1,000 Gram\)/ }))
    await user.click(screen.getByRole('button', { name: /Add package unit/ }))
    await user.type(nameInputs()[2], 'Sack')
    // New units default to "contains N × the unit above": 25 × KG.
    const qtyInputs = screen.getAllByPlaceholderText('35')
    await user.type(qtyInputs[1], '25')
    expect(await screen.findByText('= 25,000 Gram')).toBeInTheDocument()

    const retail = screen.getAllByLabelText('Retail ৳')
    await user.type(retail[1], '78')
    await user.type(retail[2], '1900')

    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await vi.waitFor(() => expect(push).toHaveBeenCalled())

    const p = await db.products.toCollection().first()
    expect(push).toHaveBeenCalledWith(`/products/view?id=${p!.id}`)
    expect(p).toMatchObject({ name: 'Miniket Rice', baseUnitName: 'Gram', allowFraction: true, stockQty: 0 })
    const units = await db.productUnits.where('productId').equals(p!.id).sortBy('sortOrder')
    expect(units.map((u) => [u.name, u.factor, u.retailPrice])).toEqual([
      ['Gram', 1, 0],
      ['KG', 1000, 7800],
      ['Sack', 25_000, 190_000],
    ])
  })

  it('shows field errors instead of saving invalid input', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(await screen.findByRole('button', { name: /Add package unit/ }))
    const unitCard = screen.getByText('Unit 2').closest('div.rounded-lg') as HTMLElement
    await user.type(within(unitCard).getByPlaceholderText('35'), '0.5')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    expect(await screen.findByText('Product name is required')).toBeInTheDocument()
    expect(screen.getByText('Name required')).toBeInTheDocument()
    expect(screen.getByText(/Must come to a whole number of Piece/)).toBeInTheDocument()
    expect(await db.products.count()).toBe(0)
  })
})
