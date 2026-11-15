import { z } from 'zod'
import { getDb } from '@/server/db'
import { requireActor, route } from '@/server/http'
import { getAvatar } from '@/server/services/users'

/** GET: a user's profile picture as an image. Any signed-in user may see it (names and faces show in the app). */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireActor()
  const { id } = await ctx.params
  const parsed = z.string().uuid().safeParse(id)
  const avatar = parsed.success ? await getAvatar(await getDb(), parsed.data) : null
  if (!avatar) return new Response(null, { status: 404 })
  // The image URL carries ?v=<version>, so a changed picture gets a new URL and this can be cached.
  return new Response(new Uint8Array(avatar.bytes), {
    headers: { 'Content-Type': avatar.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
})
