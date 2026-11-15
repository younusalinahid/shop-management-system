import { getDb } from '@/server/db'
import { json, route } from '@/server/http'
import { getDemoLogin } from '@/server/services/auth'
import { getSettings } from '@/server/services/settings'

/**
 * Public: what the login screen shows. The shop name and logo, and the demo account's credentials when a demo
 * user exists. Real accounts are never listed: visitors must know their own username.
 */
export const GET = route(async () => {
  const db = await getDb()
  const [demo, settings] = await Promise.all([getDemoLogin(db), getSettings(db)])
  return json({ shopName: settings.shopName, logo: settings.logoDataUrl || null, demo })
})
