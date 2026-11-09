import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'pos-theme'

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && !!media?.matches)
  document.documentElement.classList.toggle('dark', dark)
}

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  /** Load the saved choice. Call after mount: the server can't read localStorage, so both start at 'system'. */
  hydrate: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'system',
  hydrate: () => set({ theme: readTheme() }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* storage blocked: theme just won't persist */
    }
    apply(theme)
    set({ theme })
  },
}))

media?.addEventListener?.('change', () => apply(useThemeStore.getState().theme))
