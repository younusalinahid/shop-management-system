import { getDb } from '@/server/db'
import { json, readBody, requireActor, route } from '@/server/http'
import { getSettings, settingsPatchSchema, updateSettings } from '@/server/services/settings'

export const GET = route(async () => {
  await requireActor()
  return json(await getSettings(await getDb()))
})

export const PATCH = route(async (req) => {
  const actor = await requireActor('settings.manage')
  const patch = await readBody(req, settingsPatchSchema)
  return json(await updateSettings(await getDb(), actor, patch))
})
