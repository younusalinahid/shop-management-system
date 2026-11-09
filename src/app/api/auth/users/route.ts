import { getDb } from '@/server/db'
import { json, route } from '@/server/http'
import { listActiveUsers } from '@/server/services/auth'
import { getSettings } from '@/server/services/settings'

/**
 * Public: what the login screen shows (shop name, account names and roles; never PIN data).
 * A shared counter device picks the account, then types the PIN.
 */
export const GET = route(async () => {
  const db = await getDb()
  const [users, settings] = await Promise.all([listActiveUsers(db), getSettings(db)])
  return json({ shopName: settings.shopName, users })
})
