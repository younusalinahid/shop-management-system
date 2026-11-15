'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSessionUser } from '@/hooks/use-session'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { IMAGE_ACCEPT, ImageError, imageToDataUrl } from '@/lib/image-upload'

/** Change your own display name and profile picture (opened from the user menu in the top bar). */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('profile')
  const tc = useTranslations('common')
  const tr = useTranslations('roles')
  const user = useSessionUser()
  const router = useRouter()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.name)
  /** undefined = keep the current picture, a data URL = new one, null = remove it. */
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(undefined)
    try {
      setAvatar(await imageToDataUrl(file, { size: 256, mode: 'cover', maxChars: 120_000 }))
    } catch (e) {
      setError(e instanceof ImageError ? t(e.code === 'type' ? 'imageType' : 'imageDecode') : errorMessage(e))
    }
  }

  const trimmed = name.trim()
  const changed = trimmed !== user.name || avatar !== undefined
  const shown = avatar === undefined ? undefined : avatar
  const hasPicture = avatar === undefined ? user.avatarVersion !== null : avatar !== null

  const submit = async () => {
    if (!trimmed) return setError(t('nameRequired'))
    setBusy(true)
    setError(undefined)
    try {
      await api.patch('/api/auth/profile', { ...(trimmed !== user.name ? { name: trimmed } : {}), ...(avatar !== undefined ? { avatar } : {}) })
      toast.success(t('saved'))
      await queryClient.invalidateQueries()
      router.refresh()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('text')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex items-center gap-4">
            <UserAvatar user={{ ...user, name: trimmed || user.name, avatarVersion: hasPicture ? (user.avatarVersion ?? 0) : null }} preview={shown} size="xl" />
            <div className="grid gap-2">
              <input ref={fileRef} id="profile-photo" type="file" accept={IMAGE_ACCEPT} className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Camera /> {hasPicture ? t('changePhoto') : t('uploadPhoto')}
              </Button>
              {hasPicture && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setAvatar(null)}>
                  <Trash2 /> {t('removePhoto')}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t('photoHint')}</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-name">{t('name')}</Label>
            <Input id="profile-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">{t('username')}</dt>
            <dd className="font-semibold">@{user.username}</dd>
            <dt className="text-muted-foreground">{t('role')}</dt>
            <dd className="font-semibold">{tr(user.role)}</dd>
          </dl>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy || !changed}>
              {busy ? tc('working') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
