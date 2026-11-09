import { create } from 'zustand'
import type { User, UserRole } from '@/types/db'
import type { Actor } from '@/services/audit-service'

export interface SessionUser {
  id: string
  name: string
  username: string
  role: UserRole
}

const KEY = 'pos-session'

/** Session is kept in sessionStorage: closing the app/tab requires the PIN again. */
function readSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

interface SessionState {
  user: SessionUser | null
  signIn: (u: Pick<User, 'id' | 'name' | 'username' | 'role'>) => void
  signOut: () => void
}

export const useSession = create<SessionState>((set) => ({
  user: readSession(),
  signIn: ({ id, name, username, role }) => {
    const user = { id, name, username, role }
    try {
      sessionStorage.setItem(KEY, JSON.stringify(user))
    } catch {
      /* ignore */
    }
    set({ user })
  },
  signOut: () => {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    set({ user: null })
  },
}))

/** The signed-in user as an audit Actor. Throws if called while signed out. */
export function currentActor(): Actor {
  const u = useSession.getState().user
  if (!u) throw new Error('Not signed in')
  return { id: u.id, name: u.name }
}
