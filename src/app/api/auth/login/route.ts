import { z } from 'zod'
import { getDb } from '@/server/db'
import { startSession } from '@/server/auth/session'
import { json, readBody, route } from '@/server/http'
import { login } from '@/server/services/auth'

const loginSchema = z.object({ username: z.string().min(1).max(64), pin: z.string().min(1).max(64) })

export const POST = route(async (req) => {
  const { username, pin } = await readBody(req, loginSchema)
  const db = await getDb()
  const user = await login(db, username, pin)
  await startSession(db, user.id)
  return json({ user })
})
