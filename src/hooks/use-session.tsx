'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/types/db'

export interface SessionUser {
  id: string
  name: string
  username: string
  role: UserRole
}

const SessionContext = createContext<SessionUser | null>(null)

/** Provided by the (dashboard) server layout after it has verified the session cookie. */
export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
}

/** The signed-in user. Only valid inside the signed-in area. */
export function useSessionUser(): SessionUser {
  const user = useContext(SessionContext)
  if (!user) throw new Error('useSessionUser must be used inside SessionProvider')
  return user
}

/** The signed-in user, or null outside the signed-in area (e.g. tests rendering a page alone). */
export function useOptionalSessionUser(): SessionUser | null {
  return useContext(SessionContext)
}
