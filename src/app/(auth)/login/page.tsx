import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LoginPage } from '@/components/auth/login-page'
import { entryState } from '@/server/auth/entry'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()
  return { title: `${t('auth.signIn')} · ${t('app.title')}` }
}

export default async function Page() {
  const state = await entryState()
  if (state.kind === 'setup') redirect('/setup')
  if (state.kind === 'app') redirect('/dashboard')
  return <LoginPage />
}
