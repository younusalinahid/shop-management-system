import { create } from 'zustand'

const KEY = 'pos-sidebar'

interface Saved {
  collapsed: boolean
  closedGroups: string[]
}

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
    return {
      collapsed: raw.collapsed === true,
      closedGroups: Array.isArray(raw.closedGroups) ? raw.closedGroups.filter((g) => typeof g === 'string') : [],
    }
  } catch {
    return { collapsed: false, closedGroups: [] }
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private mode or blocked storage: the sidebar still works, it just forgets next time.
  }
}

interface SidebarState extends Saved {
  /** Load the saved state in the browser, after the first render (so server and client markup match). */
  hydrate: () => void
  toggleCollapsed: () => void
  toggleGroup: (id: string) => void
}

/** Desktop sidebar: icon-only rail or full width, and which nav sections are folded. Saved in this browser only. */
export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: false,
  closedGroups: [],
  hydrate: () => set(read()),
  toggleCollapsed: () => {
    const next = { collapsed: !get().collapsed, closedGroups: get().closedGroups }
    save(next)
    set(next)
  },
  toggleGroup: (id) => {
    const { collapsed, closedGroups } = get()
    const next = { collapsed, closedGroups: closedGroups.includes(id) ? closedGroups.filter((g) => g !== id) : [...closedGroups, id] }
    save(next)
    set(next)
  },
}))
