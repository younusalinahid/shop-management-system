import { z } from 'zod'
import { getDb } from '@/server/db'
import { startSession } from '@/server/auth/session'
import { json, readBody, route } from '@/server/http'
import { SYSTEM_ACTOR } from '@/server/services/audit'
import { createInitialOwner, hasAnyUser, pinSchema, usernameSchema } from '@/server/services/auth'
import { updateSettings } from '@/server/services/settings'

/** GET: does the shop still need first-run setup? */
export const GET = route(async () => {
  const db = await getDb()
  return json({ needsSetup: !(await hasAnyUser(db)) })
})

const setupSchema = z.object({
  shopName: z.string().trim().min(1, 'v.shopNameRequired').max(100),
  shopPhone: z.string().trim().max(30).default(''),
  shopAddress: z.string().trim().max(200).default(''),
  name: z.string().trim().min(1, 'v.yourNameRequired').max(80),
  username: usernameSchema,
  pin: pinSchema,
})

/** POST: create the owner account and shop details, then sign the owner in. Only works once. */
export const POST = route(async (req) => {
  const body = await readBody(req, setupSchema)
  const db = await getDb()
  const user = await createInitialOwner(db, { name: body.name, username: body.username, pin: body.pin })
  await updateSettings(db, SYSTEM_ACTOR, { shopName: body.shopName, shopPhone: body.shopPhone, shopAddress: body.shopAddress })
  await startSession(db, user.id)
  return json({ user }, { status: 201 })
})
