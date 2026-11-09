/** Supported UI languages. Data the user types (product names, units) is never translated. */
export const LOCALES = ['en', 'bn'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Cookie holding the chosen language; read by the server so the first render is already translated. */
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', bn: 'বাংলা' }

export function toLocale(value: string | undefined | null): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE
}

/**
 * Validation messages in shared Zod schemas are keys ("v.nameRequired") so the browser and the
 * API can both show them in the user's language. Anything else is shown as is.
 */
export const VALIDATION_PREFIX = 'v.'
