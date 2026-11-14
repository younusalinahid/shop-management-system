import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import { SetupPage } from '@/components/auth/setup-page'
import { NotFoundPage } from '@/components/shared/not-found-page'
import { newId } from '@/lib/id'
import bn from '../../messages/bn.json'
import en from '../../messages/en.json'
import { apiJson } from '../helpers/api'
import { setTestCookie } from '../helpers/cookies'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }))

type Tree = { [key: string]: string | Tree }
const flatten = (o: Tree, p = ''): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v]] : Object.entries(flatten(v, `${p}${k}.`)))))
// Argument names only ("{name}", "{count, plural, …}"), not the text inside plural branches.
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort()

describe('messages', () => {
  it('Bangla has exactly the English keys and the same placeholders', () => {
    const e = flatten(en)
    const b = flatten(bn)
    expect(Object.keys(b).sort()).toEqual(Object.keys(e).sort())
    for (const key of Object.keys(e)) expect([key, placeholders(b[key])]).toEqual([key, placeholders(e[key])])
  })
})

describe('Bangla UI', () => {
  const renderBn = (ui: React.ReactNode) =>
    render(
      <NextIntlClientProvider locale="bn" messages={bn} timeZone="Asia/Dhaka">
        {ui}
      </NextIntlClientProvider>,
    )

  it('renders page text in Bangla', () => {
    renderBn(<NotFoundPage />)
    expect(screen.getByText('পাতাটি পাওয়া যায়নি')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ড্যাশবোর্ডে যান' })).toBeInTheDocument()
  })

  it('shows form validation messages in Bangla', async () => {
    renderBn(<SetupPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('দোকানের নাম'), 'রহমান স্টোর')
    await user.type(screen.getByLabelText('আপনার নাম'), 'করিম')
    await user.type(screen.getByLabelText('PIN / পাসওয়ার্ড'), '2468')
    await user.type(screen.getByLabelText('PIN নিশ্চিত করুন'), '9999')
    await user.click(screen.getByRole('button', { name: 'দোকান তৈরি করুন' }))
    expect(await screen.findByText('দুটি PIN মিলছে না')).toBeInTheDocument()
  })
})

describe('API errors follow the language cookie', () => {
  const setup = { shopName: 'Shop', name: 'Karim', username: 'owner', pin: '2468' }

  it('answers validation errors in Bangla when NEXT_LOCALE=bn', async () => {
    setTestCookie('NEXT_LOCALE', 'bn')
    const res = await apiJson<{ error: { message: string } }>('POST', '/api/setup', { ...setup, pin: '12' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('PIN কমপক্ষে ৪ অক্ষরের হতে হবে')
  })

  it('answers business errors in Bangla, with values filled in', async () => {
    await apiJson('POST', '/api/setup', setup)
    setTestCookie('NEXT_LOCALE', 'bn')
    const product = {
      name: 'চাল',
      sku: 'rice-1',
      allowFraction: true,
      minStockQty: 0,
      taxRate: 0,
      trackBatches: false,
      trackExpiry: false,
      units: [{ id: newId(), name: 'Gram', factor: 1, isBase: true, canPurchase: true, canSell: true, retailPrice: 0, wholesalePrice: 0, purchasePrice: 0 }],
      barcodes: [],
    }
    await apiJson('POST', '/api/products', product)
    const dup = await apiJson<{ error: { message: string } }>('POST', '/api/products', { ...product, units: [{ ...product.units[0], id: newId() }] })
    expect(dup.status).toBe(409)
    expect(dup.body.error.message).toBe('SKU RICE-1 আগেই “চাল” পণ্যে ব্যবহার হচ্ছে।')
  })

  it('stays in English without the cookie', async () => {
    const res = await apiJson<{ error: { message: string } }>('POST', '/api/setup', { ...setup, pin: '12' })
    expect(res.body.error.message).toBe('PIN must be at least 4 characters')
  })
})
