import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { LOCALE_COOKIE, toLocale } from './config'
import { loadMessages } from './messages'

/** next-intl request config: language from the cookie (no /bn URL prefix). */
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  return { locale, messages: await loadMessages(locale), timeZone: 'Asia/Dhaka' }
})
