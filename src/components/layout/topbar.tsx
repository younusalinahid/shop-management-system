'use client'

import { useState } from 'react'
import { KeyRound, LogOut, Menu, Monitor, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
import { ChangePinDialog } from '@/components/admin/users-page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useOnline } from '@/hooks/use-online'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from './language-switcher'
import { useRouter } from 'next/navigation'
import { useSessionUser } from '@/hooks/use-session'
import { api } from '@/lib/api-client'
import { type Theme, useThemeStore } from '@/stores/theme-store'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const online = useOnline()
  const user = useSessionUser()
  const router = useRouter()
  const { theme, setTheme } = useThemeStore()
  const t = useTranslations('shell')
  const tr = useTranslations('roles')
  const [changingPin, setChangingPin] = useState(false)
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  const handleSignOut = async () => {
    await api.post('/api/auth/logout').catch(() => {})
    router.replace('/login')
    router.refresh()
  }

  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/90 px-3 shadow-sm shadow-black/[0.03] backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label={t('openNavigation')}>
        <Menu className="size-5" />
      </Button>
      <div className="flex-1" />
      <span
        className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:flex ${
          online ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'
        }`}
        title={online ? t('onlineHint') : t('offlineHint')}
      >
        {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {online ? t('online') : t('offline')}
      </span>
      <LanguageSwitcher />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('changeTheme')}>
            <ThemeIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <DropdownMenuRadioItem value="light">{t('themeLight')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">{t('themeDark')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">{t('themeSystem')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-strong text-sm font-bold text-primary-foreground shadow-sm">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight font-semibold">{user.name}</span>
                <span className="block text-xs leading-tight text-muted-foreground">{tr(user.role)}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm">{user.name}</span>
              <span className="block text-xs text-muted-foreground">@{user.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setChangingPin(true)}>
              <KeyRound className="size-4" /> {t('changePin')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleSignOut()}>
              <LogOut className="size-4" /> {t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {changingPin && <ChangePinDialog onClose={() => setChangingPin(false)} />}
    </header>
  )
}
