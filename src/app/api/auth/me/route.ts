import { json, requireActor, route } from '@/server/http'

export const GET = route(async () => {
  const { user } = await requireActor()
  return json({ user })
})
