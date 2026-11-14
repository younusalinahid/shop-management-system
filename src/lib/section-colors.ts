import { NAV_GROUPS } from '@/constants/navigation'

/**
 * Each sidebar section has its own color, used by the sidebar, the page header and (where it fits)
 * the dashboard. Tailwind only generates classes it can see as whole strings, so every class is
 * written out here instead of being built from the hue name.
 */
export interface Hue {
  /** Soft tile behind an icon (page header, sidebar). */
  tile: string
  /** Solid gradient tile with a white icon (dashboard cards, logo). */
  solid: string
  /** Icon color on the dark sidebar. */
  sidebarIcon: string
  /** Active sidebar row: background, left bar and icon. */
  sidebarActive: string
  /** Small dot next to a sidebar group label. */
  dot: string
  /** Thin gradient line under a page header. */
  line: string
}

export const HUES = {
  indigo: {
    tile: 'bg-indigo-500/12 text-indigo-600 ring-indigo-500/25 dark:text-indigo-300',
    solid: 'bg-gradient-to-br from-indigo-400 to-indigo-600 shadow-indigo-500/30',
    sidebarIcon: 'text-indigo-300',
    sidebarActive: 'bg-indigo-400/15 border-indigo-400/50 before:bg-indigo-400 [&_svg]:text-indigo-300',
    dot: 'bg-indigo-400',
    line: 'from-indigo-500 to-indigo-500/0',
  },
  emerald: {
    tile: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300',
    solid: 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/30',
    sidebarIcon: 'text-emerald-300',
    sidebarActive: 'bg-emerald-400/15 border-emerald-400/50 before:bg-emerald-400 [&_svg]:text-emerald-300',
    dot: 'bg-emerald-400',
    line: 'from-emerald-500 to-emerald-500/0',
  },
  violet: {
    tile: 'bg-violet-500/12 text-violet-600 ring-violet-500/25 dark:text-violet-300',
    solid: 'bg-gradient-to-br from-violet-400 to-violet-600 shadow-violet-500/30',
    sidebarIcon: 'text-violet-300',
    sidebarActive: 'bg-violet-400/15 border-violet-400/50 before:bg-violet-400 [&_svg]:text-violet-300',
    dot: 'bg-violet-400',
    line: 'from-violet-500 to-violet-500/0',
  },
  amber: {
    tile: 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300',
    solid: 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/30',
    sidebarIcon: 'text-amber-300',
    sidebarActive: 'bg-amber-400/15 border-amber-400/50 before:bg-amber-400 [&_svg]:text-amber-300',
    dot: 'bg-amber-400',
    line: 'from-amber-500 to-amber-500/0',
  },
  sky: {
    tile: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-300',
    solid: 'bg-gradient-to-br from-sky-400 to-cyan-600 shadow-sky-500/30',
    sidebarIcon: 'text-sky-300',
    sidebarActive: 'bg-sky-400/15 border-sky-400/50 before:bg-sky-400 [&_svg]:text-sky-300',
    dot: 'bg-sky-400',
    line: 'from-sky-500 to-sky-500/0',
  },
  pink: {
    tile: 'bg-pink-500/12 text-pink-600 ring-pink-500/25 dark:text-pink-300',
    solid: 'bg-gradient-to-br from-pink-400 to-pink-600 shadow-pink-500/30',
    sidebarIcon: 'text-pink-300',
    sidebarActive: 'bg-pink-400/15 border-pink-400/50 before:bg-pink-400 [&_svg]:text-pink-300',
    dot: 'bg-pink-400',
    line: 'from-pink-500 to-pink-500/0',
  },
  rose: {
    tile: 'bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-300',
    solid: 'bg-gradient-to-br from-rose-400 to-red-500 shadow-rose-500/30',
    sidebarIcon: 'text-rose-300',
    sidebarActive: 'bg-rose-400/15 border-rose-400/50 before:bg-rose-400 [&_svg]:text-rose-300',
    dot: 'bg-rose-400',
    line: 'from-rose-500 to-rose-500/0',
  },
  fuchsia: {
    tile: 'bg-fuchsia-500/12 text-fuchsia-600 ring-fuchsia-500/25 dark:text-fuchsia-300',
    solid: 'bg-gradient-to-br from-fuchsia-400 to-purple-600 shadow-fuchsia-500/30',
    sidebarIcon: 'text-fuchsia-300',
    sidebarActive: 'bg-fuchsia-400/15 border-fuchsia-400/50 before:bg-fuchsia-400 [&_svg]:text-fuchsia-300',
    dot: 'bg-fuchsia-400',
    line: 'from-fuchsia-500 to-fuchsia-500/0',
  },
  teal: {
    tile: 'bg-teal-500/12 text-teal-600 ring-teal-500/25 dark:text-teal-300',
    solid: 'bg-gradient-to-br from-teal-400 to-teal-600 shadow-teal-500/30',
    sidebarIcon: 'text-teal-300',
    sidebarActive: 'bg-teal-400/15 border-teal-400/50 before:bg-teal-400 [&_svg]:text-teal-300',
    dot: 'bg-teal-400',
    line: 'from-teal-500 to-teal-500/0',
  },
} as const satisfies Record<string, Hue>

export type HueName = keyof typeof HUES

const GROUP_HUE: Record<string, HueName> = {
  overview: 'indigo',
  sales: 'emerald',
  catalog: 'violet',
  inventory: 'amber',
  purchasing: 'sky',
  parties: 'pink',
  money: 'rose',
  insights: 'fuchsia',
  administration: 'teal',
}

export const hueForGroup = (groupId: string): Hue => HUES[GROUP_HUE[groupId] ?? 'indigo']

/** The hue of the sidebar section a pathname belongs to (sub-pages included). Indigo when none matches. */
export function hueForPath(pathname: string): Hue {
  for (const group of NAV_GROUPS) {
    if (group.items.some((i) => pathname === i.path || pathname.startsWith(i.path + '/'))) return hueForGroup(group.id)
  }
  return HUES.indigo
}
