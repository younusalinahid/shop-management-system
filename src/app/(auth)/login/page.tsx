import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginPage } from '@/components/auth/login-page'
import { entryState } from '@/server/auth/entry'

export const metadata: Metadata = { title: 'Sign in · Shop Management System (POS)' }

export default async function Page() {
  const state = await entryState()
  if (state.kind === 'setup') redirect('/setup')
  if (state.kind === 'app') redirect('/dashboard')
  return <LoginPage />
}
