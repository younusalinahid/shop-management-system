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

/** Brand hue (0–360) behind every colored token; 277 is the default indigo. */
export const DEFAULT_HUE = 277
const HUE_KEY = 'pos-hue'

/** The saved color, or null while the user has not picked one (the app then uses its default look with a black sidebar). */
function readHue(): number | null {
  try {
    const raw = localStorage.getItem(HUE_KEY)
    const h = Number(raw)
    return raw !== null && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null
  } catch {
    return null
  }
}

function applyHue(hue: number | null) {
  const root = document.documentElement
  if (hue === null) {
    root.style.removeProperty('--h')
    root.removeAttribute('data-accent')
  } else {
    root.style.setProperty('--h', String(hue))
    root.setAttribute('data-accent', '')
  }
}

interface ThemeState {
  theme: Theme
  /** The color the user picked, or null for the default. */
  hue: number | null
  setTheme: (t: Theme) => void
  setHue: (h: number | null) => void
  /** Load the saved choice. Call after mount: the server can't read localStorage, so both start at 'system'. */
  hydrate: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'system',
  hue: null,
  hydrate: () => set({ theme: readTheme(), hue: readHue() }),
  setHue: (hue) => {
    const h = hue === null ? null : Math.round(Math.min(360, Math.max(0, hue)))
    try {
      if (h === null) localStorage.removeItem(HUE_KEY)
      else localStorage.setItem(HUE_KEY, String(h))
    } catch {
      /* storage blocked: the color just won't persist */
    }
    applyHue(h)
    set({ hue: h })
  },
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
