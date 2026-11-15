import { NAV_GROUPS } from '@/constants/navigation'

/**
 * Each sidebar section has its own color, used by the sidebar, the page header and (where it fits)
 * the dashboard. Tailwind only generates classes it can see as whole strings, so every class is
 * written out here instead of being built from the hue name.
 */
export interface Hue {
  /** Soft tile behind an icon (page header, sidebar). */
  tile: string
  /** Pastel squircle badge behind an icon (dashboard cards, page headers). */
  solid: string
  /** Icon color on the dark sidebar. */
  sidebarIcon: string
  /** Active sidebar row: background, left bar and icon. */
  sidebarActive: string
  /** Small dot next to a sidebar group label. */
  dot: string
  /** Thin gradient line under a page header. */
  line: string
  /** Text color for sparklines. */
  spark: string
  /** Corner glow gradient on a KPI card. */
  glow: string
}

export const HUES = {
  indigo: {
    tile: 'bg-indigo-500/12 text-indigo-600 ring-indigo-500/25 dark:text-indigo-300',
    solid: 'bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-500/20 shadow-sm shadow-indigo-500/15 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/25 dark:shadow-none',
    spark: 'text-indigo-500',
    glow: 'from-indigo-500/30 to-indigo-500/0',
    sidebarIcon: 'text-indigo-300',
    sidebarActive: 'bg-white/[0.09] before:bg-indigo-400 before:shadow-[0_0_14px_2px] before:shadow-indigo-400/70 [&_svg]:text-indigo-300',
    dot: 'bg-indigo-400',
    line: 'from-indigo-500 to-indigo-500/0',
  },
  emerald: {
    tile: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300',
    solid: 'bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 shadow-sm shadow-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25 dark:shadow-none',
    spark: 'text-emerald-500',
    glow: 'from-emerald-500/30 to-emerald-500/0',
    sidebarIcon: 'text-emerald-300',
    sidebarActive: 'bg-white/[0.09] before:bg-emerald-400 before:shadow-[0_0_14px_2px] before:shadow-emerald-400/70 [&_svg]:text-emerald-300',
    dot: 'bg-emerald-400',
    line: 'from-emerald-500 to-emerald-500/0',
  },
  violet: {
    tile: 'bg-violet-500/12 text-violet-600 ring-violet-500/25 dark:text-violet-300',
    solid: 'bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-500/20 shadow-sm shadow-violet-500/15 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25 dark:shadow-none',
    spark: 'text-violet-500',
    glow: 'from-violet-500/30 to-violet-500/0',
    sidebarIcon: 'text-violet-300',
    sidebarActive: 'bg-white/[0.09] before:bg-violet-400 before:shadow-[0_0_14px_2px] before:shadow-violet-400/70 [&_svg]:text-violet-300',
    dot: 'bg-violet-400',
    line: 'from-violet-500 to-violet-500/0',
  },
  amber: {
    tile: 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300',
    solid: 'bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-500/20 shadow-sm shadow-amber-500/15 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25 dark:shadow-none',
    spark: 'text-amber-500',
    glow: 'from-amber-500/30 to-amber-500/0',
    sidebarIcon: 'text-amber-300',
    sidebarActive: 'bg-white/[0.09] before:bg-amber-400 before:shadow-[0_0_14px_2px] before:shadow-amber-400/70 [&_svg]:text-amber-300',
    dot: 'bg-amber-400',
    line: 'from-amber-500 to-amber-500/0',
  },
  sky: {
    tile: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-300',
    solid: 'bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-500/20 shadow-sm shadow-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25 dark:shadow-none',
    spark: 'text-sky-500',
    glow: 'from-sky-500/30 to-sky-500/0',
    sidebarIcon: 'text-sky-300',
    sidebarActive: 'bg-white/[0.09] before:bg-sky-400 before:shadow-[0_0_14px_2px] before:shadow-sky-400/70 [&_svg]:text-sky-300',
    dot: 'bg-sky-400',
    line: 'from-sky-500 to-sky-500/0',
  },
  pink: {
    tile: 'bg-pink-500/12 text-pink-600 ring-pink-500/25 dark:text-pink-300',
    solid: 'bg-pink-50 text-pink-600 ring-1 ring-inset ring-pink-500/20 shadow-sm shadow-pink-500/15 dark:bg-pink-500/15 dark:text-pink-300 dark:ring-pink-400/25 dark:shadow-none',
    spark: 'text-pink-500',
    glow: 'from-pink-500/30 to-pink-500/0',
    sidebarIcon: 'text-pink-300',
    sidebarActive: 'bg-white/[0.09] before:bg-pink-400 before:shadow-[0_0_14px_2px] before:shadow-pink-400/70 [&_svg]:text-pink-300',
    dot: 'bg-pink-400',
    line: 'from-pink-500 to-pink-500/0',
  },
  rose: {
    tile: 'bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-300',
    solid: 'bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-500/20 shadow-sm shadow-rose-500/15 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25 dark:shadow-none',
    spark: 'text-rose-500',
    glow: 'from-rose-500/30 to-rose-500/0',
    sidebarIcon: 'text-rose-300',
    sidebarActive: 'bg-white/[0.09] before:bg-rose-400 before:shadow-[0_0_14px_2px] before:shadow-rose-400/70 [&_svg]:text-rose-300',
    dot: 'bg-rose-400',
    line: 'from-rose-500 to-rose-500/0',
  },
  fuchsia: {
    tile: 'bg-fuchsia-500/12 text-fuchsia-600 ring-fuchsia-500/25 dark:text-fuchsia-300',
    solid: 'bg-fuchsia-50 text-fuchsia-600 ring-1 ring-inset ring-fuchsia-500/20 shadow-sm shadow-fuchsia-500/15 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:ring-fuchsia-400/25 dark:shadow-none',
    spark: 'text-fuchsia-500',
    glow: 'from-fuchsia-500/30 to-fuchsia-500/0',
    sidebarIcon: 'text-fuchsia-300',
    sidebarActive: 'bg-white/[0.09] before:bg-fuchsia-400 before:shadow-[0_0_14px_2px] before:shadow-fuchsia-400/70 [&_svg]:text-fuchsia-300',
    dot: 'bg-fuchsia-400',
    line: 'from-fuchsia-500 to-fuchsia-500/0',
  },
  teal: {
    tile: 'bg-teal-500/12 text-teal-600 ring-teal-500/25 dark:text-teal-300',
    solid: 'bg-teal-50 text-teal-600 ring-1 ring-inset ring-teal-500/20 shadow-sm shadow-teal-500/15 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/25 dark:shadow-none',
    spark: 'text-teal-500',
    glow: 'from-teal-500/30 to-teal-500/0',
    sidebarIcon: 'text-teal-300',
    sidebarActive: 'bg-white/[0.09] before:bg-teal-400 before:shadow-[0_0_14px_2px] before:shadow-teal-400/70 [&_svg]:text-teal-300',
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
