'use client'

import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus, UserCheck, UserCog, UserX } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSessionUser } from '@/hooks/use-session'
import { api } from '@/lib/api-client'
import { formatDateTime } from '@/lib/datetime'
import { errorMessage } from '@/lib/errors'
import { ROLE_PERMISSIONS } from '@/lib/permissions'
import type { UserRole } from '@/types/db'

interface UserRecord {
  id: string
  name: string
  username: string
  role: UserRole
  status: 'active' | 'archived'
  lastLoginAt?: number
  createdAt: number
}

const ROLES: UserRole[] = ['owner', 'manager', 'cashier']

/** Owner-only user management: add users, change roles, reset PINs, disable accounts. */
export function UsersPage() {
  const t = useTranslations('users')
  const tr = useTranslations('roles')
  const me = useSessionUser()
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit' | 'pin'; user: UserRecord } | null>(null)
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: UserRecord[] }>('/api/users') })

  const toggle = async (u: UserRecord) => {
    try {
      await api.patch(`/api/users/${u.id}`, { status: u.status === 'active' ? 'archived' : 'active' })
      await q.refetch()
      toast.success(u.status === 'active' ? t('disabledToast', { name: u.name }) : t('enabledToast', { name: u.name }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        icon={UserCog}
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setDialog({ mode: 'new' })}>
            <Plus /> {t('add')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="gap-0 py-0">
          {q.isPending ? (
            <LoadingState />
          ) : q.isError ? (
            <div className="p-4">
              <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('role')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('lastLogin')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((u) => (
                  <TableRow key={u.id} className={u.status === 'archived' ? 'opacity-60' : undefined}>
                    <TableCell>
                      <p className="font-semibold">
                        {u.name}
                        {u.id === me.id && <span className="ml-1 text-xs font-normal text-muted-foreground">({t('you')})</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">@{u.username}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'owner' ? 'default' : u.role === 'manager' ? 'success' : 'muted'}>{tr(u.role)}</Badge>
                      {u.status === 'archived' && (
                        <Badge variant="destructive" className="ml-1">
                          {t('disabled')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('never')}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" onClick={() => setDialog({ mode: 'edit', user: u })} aria-label={t('editNamed', { name: u.name })}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setDialog({ mode: 'pin', user: u })} aria-label={t('pinNamed', { name: u.name })}>
                          <KeyRound />
                        </Button>
                        {u.id !== me.id && (
                          <Button size="icon-sm" variant="ghost" className={u.status === 'active' ? 'text-destructive' : 'text-success'} onClick={() => void toggle(u)} aria-label={u.status === 'active' ? t('disableNamed', { name: u.name }) : t('enableNamed', { name: u.name })}>
                            {u.status === 'active' ? <UserX /> : <UserCheck />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card className="self-start">
          <CardContent className="grid gap-4 pt-6 text-sm">
            {ROLES.map((r) => (
              <div key={r}>
                <p className="font-semibold">{tr(r)}</p>
                <p className="text-muted-foreground">{t(`roleHint.${r}`, { count: ROLE_PERMISSIONS[r].size })}</p>
              </div>
            ))}
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('securityNote')}</p>
          </CardContent>
        </Card>
      </div>
      {dialog && <UserDialog state={dialog} onClose={() => setDialog(null)} onDone={() => void q.refetch()} />}
    </>
  )
}

function UserDialog({ state, onClose, onDone }: { state: { mode: 'new' } | { mode: 'edit' | 'pin'; user: UserRecord }; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('users')
  const tr = useTranslations('roles')
  const tc = useTranslations('common')
  const ids = useId()
  const user = state.mode === 'new' ? undefined : state.user
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<UserRole>(user?.role ?? 'cashier')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    setError(undefined)
    if (state.mode !== 'pin' && !name.trim()) return setError(t('nameRequired'))
    if (state.mode !== 'edit' && pin.length < 4) return setError(t('pinShort'))
    setBusy(true)
    try {
      if (state.mode === 'new') await api.post('/api/users', { name, username, role, pin })
      else if (state.mode === 'edit') await api.put(`/api/users/${state.user.id}`, { name, role })
      else await api.post(`/api/users/${state.user.id}/pin`, { pin })
      toast.success(state.mode === 'pin' ? t('pinToast', { name: user!.name }) : t('savedToast', { name }))
      onDone()
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
          <DialogTitle>{state.mode === 'new' ? t('newTitle') : state.mode === 'edit' ? t('editTitle') : t('pinTitle', { name: user!.name })}</DialogTitle>
          <DialogDescription>{state.mode === 'pin' ? t('pinText') : t('formText')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {state.mode !== 'pin' && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-name`}>{t('name')}</Label>
                <Input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              {state.mode === 'new' && (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${ids}-username`}>{t('username')}</Label>
                  <Input id={`${ids}-username`} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={`${ids}-role`}>{t('role')}</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger id={`${ids}-role`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {tr(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {state.mode !== 'edit' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-pin`}>{state.mode === 'pin' ? t('newPin') : t('pin')}</Label>
              <Input id={`${ids}-pin`} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus={state.mode === 'pin'} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tc('working') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Change your own PIN (opened from the user menu in the top bar). */
export function ChangePinDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('users')
  const tc = useTranslations('common')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async () => {
    setError(undefined)
    if (next.length < 4) return setError(t('pinShort'))
    if (next !== again) return setError(t('pinMismatch'))
    setBusy(true)
    try {
      await api.post('/api/auth/pin', { currentPin: current, newPin: next })
      toast.success(t('ownPinToast'))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  const field = (id: string, label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} autoFocus={autoFocus} />
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('ownPinTitle')}</DialogTitle>
          <DialogDescription>{t('ownPinText')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {field('pin-current', t('currentPin'), current, setCurrent, true)}
          {field('pin-new', t('newPin'), next, setNext)}
          {field('pin-again', t('repeatPin'), again, setAgain)}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tc('working') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
