import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DashboardPage } from '@/components/dashboard/dashboard-page'
import { db } from '@/db/database'
import { AppBoot } from '@/components/layout/app-boot'

// jsdom lacks matchMedia
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

const renderApp = () =>
  render(
    <AppBoot>
      <DashboardPage />
    </AppBoot>,
  )

describe('AppBoot first run', () => {
  it('shows setup, creates the owner, and lands on the dashboard', async () => {
    renderApp()
    expect(await screen.findByText('Set up your shop')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Shop name'), 'Rahman Store')
    await user.type(screen.getByLabelText('Your name'), 'Karim')
    await user.type(screen.getByLabelText('PIN / password'), '2468')
    await user.type(screen.getByLabelText('Confirm PIN'), '2468')
    await user.click(screen.getByRole('button', { name: 'Create shop' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await db.users.count()).toBe(1)
    expect((await db.settings.get('app'))?.shopName).toBe('Rahman Store')
  }, 15_000) // PBKDF2 PIN hashing is deliberately slow; leave headroom when the whole suite runs in parallel.

  it('validates mismatched PINs', async () => {
    renderApp()
    await screen.findByText('Set up your shop')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Shop name'), 'Shop')
    await user.type(screen.getByLabelText('Your name'), 'Karim')
    await user.type(screen.getByLabelText('PIN / password'), '2468')
    await user.type(screen.getByLabelText('Confirm PIN'), '9999')
    await user.click(screen.getByRole('button', { name: 'Create shop' }))
    expect(await screen.findByText('PINs do not match')).toBeInTheDocument()
    expect(await db.users.count()).toBe(0)
  })
})
