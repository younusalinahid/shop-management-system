import 'server-only'
import { cookies } from 'next/headers'
import { createTranslator } from 'next-intl'
import { LOCALE_COOKIE, toLocale } from '@/i18n/config'
import { loadMessages } from '@/i18n/messages'
import type { Translator } from '@/i18n/translate'

/**
 * Translator for the current request's language (from the NEXT_LOCALE cookie), usable in Route
 * Handlers and services. Unlike next-intl's getTranslations it needs no request config, so it
 * also works in tests.
 */
export async function getServerT(): Promise<Translator> {
  let locale = toLocale(undefined)
  try {
    locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  } catch {
    // Called outside a request (scripts): use the default language.
  }
  const messages = await loadMessages(locale)
  return createTranslator({ locale, messages }) as unknown as Translator
}
