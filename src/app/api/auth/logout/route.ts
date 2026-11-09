import { getDb } from '@/server/db'
import { endSession, getSessionUser } from '@/server/auth/session'
import { json, route } from '@/server/http'
import { writeAudit } from '@/server/services/audit'

export const POST = route(async () => {
  const user = await getSessionUser()
  if (user) {
    const db = await getDb()
    await writeAudit(db, user, { action: 'user.logout', module: 'auth', entityId: user.id })
  }
  await endSession()
  return json({ ok: true })
})
