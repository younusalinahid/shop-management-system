import 'server-only'
import { redirect } from 'next/navigation'
import { getDb } from '../db'
import { hasAnyUser } from '../services/auth'
import { getSessionUser, type SessionUser } from './session'

/**
 * Where a visitor belongs: first-run setup, the login screen, or the app.
 * Used by server pages and layouts to redirect before anything renders.
 */
export async function entryState(): Promise<{ kind: 'setup' } | { kind: 'login' } | { kind: 'app'; user: SessionUser }> {
  const user = await getSessionUser()
  if (user) return { kind: 'app', user }
  return (await hasAnyUser(await getDb())) ? { kind: 'login' } : { kind: 'setup' }
}

/** The signed-in user, or a redirect to /setup or /login. */
export async function requirePageUser(): Promise<SessionUser> {
  const state = await entryState()
  if (state.kind === 'setup') redirect('/setup')
  if (state.kind === 'login') redirect('/login')
  return state.user
}
