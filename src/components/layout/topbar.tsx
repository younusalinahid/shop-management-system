'use client'

import { LogOut, Menu, Monitor, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
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
import { ROLE_LABELS } from '@/lib/permissions'
import { useRouter } from 'next/navigation'
import { useSessionUser } from '@/hooks/use-session'
import { api } from '@/lib/api-client'
import { type Theme, useThemeStore } from '@/stores/theme-store'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const online = useOnline()
  const user = useSessionUser()
  const router = useRouter()
  const { theme, setTheme } = useThemeStore()
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  const handleSignOut = async () => {
    await api.post('/api/auth/logout').catch(() => {})
    router.replace('/login')
    router.refresh()
  }

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>
      <div className="flex-1" />
      <span
        className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:flex ${
          online ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'
        }`}
        title={online ? 'Connected to the server.' : 'No internet connection. Changes cannot be saved until it is back.'}
      >
        {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {online ? 'Online' : 'Offline'}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Change theme">
            <ThemeIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight">{user.name}</span>
                <span className="block text-xs leading-tight text-muted-foreground">{ROLE_LABELS[user.role]}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm">{user.name}</span>
              <span className="block text-xs text-muted-foreground">@{user.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSignOut()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
