import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { SetupPage } from '@/components/auth/setup-page'
import { entryState } from '@/server/auth/entry'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()
  return { title: `${t('auth.setupTitle')} · ${t('app.title')}` }
}

/** First-run only: once an owner exists, this page redirects away. */
export default async function Page() {
  const state = await entryState()
  if (state.kind === 'login') redirect('/login')
  if (state.kind === 'app') redirect('/dashboard')
  return <SetupPage />
}
