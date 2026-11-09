import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SetupPage } from '@/components/auth/setup-page'
import { entryState } from '@/server/auth/entry'

export const metadata: Metadata = { title: 'Set up · Shop Management System (POS)' }

/** First-run only: once an owner exists, this page redirects away. */
export default async function Page() {
  const state = await entryState()
  if (state.kind === 'login') redirect('/login')
  if (state.kind === 'app') redirect('/dashboard')
  return <SetupPage />
}
