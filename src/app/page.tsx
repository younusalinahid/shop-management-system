import { redirect } from 'next/navigation'
import { requirePageUser } from '@/server/auth/entry'

/** "/" sends visitors to setup, login or the dashboard. */
export default async function HomePage() {
  await requirePageUser()
  redirect('/dashboard')
}
