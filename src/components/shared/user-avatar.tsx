'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'size-8 rounded-lg text-xs',
  md: 'size-9 rounded-xl text-sm',
  lg: 'size-12 rounded-2xl text-lg',
  xl: 'size-24 rounded-[1.75rem] text-3xl',
} as const

interface AvatarUser {
  id: string
  name: string
  /** Version of the stored picture, or null when the user has none. */
  avatarVersion: number | null
}

/** The user's profile picture, or their initial on the brand gradient when there is none. */
export function UserAvatar({ user, size = 'md', className, preview }: { user: AvatarUser; size?: keyof typeof SIZES; className?: string; preview?: string | null }) {
  const src = preview ?? (user.avatarVersion !== null ? `/api/users/${user.id}/avatar?v=${user.avatarVersion}` : null)
  return <AvatarImage key={src ?? 'none'} src={src} name={user.name} size={size} className={className} />
}

function AvatarImage({ src, name, size, className }: { src: string | null; name: string; size: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState(false)
  const base = cn('relative flex shrink-0 items-center justify-center overflow-hidden font-bold ring-1 ring-inset ring-black/5 select-none', SIZES[size], className)
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element -- a small same-origin image; next/image adds nothing here
    return <img src={src} alt="" onError={() => setFailed(true)} className={cn(base, 'object-cover')} />
  }
  return (
    <span className={cn(base, 'bg-brand text-white')} aria-hidden>
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
