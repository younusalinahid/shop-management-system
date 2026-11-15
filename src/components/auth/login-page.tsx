'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { ArrowRight, Boxes, Check, Eye, EyeOff, Loader2, Lock, Receipt, ScanBarcode, Sparkles, Store, TrendingUp, User, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'

interface LoginInfo {
  shopName: string
  demo: { username: string; password: string } | null
}

export function LoginPage() {
  const router = useRouter()
  const t = useTranslations('auth')
  const { data } = useQuery({ queryKey: ['login-info'], queryFn: () => api.get<LoginInfo>('/api/auth/users') })
  const demo = data?.demo
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [remember, setRemember] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !pin) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { username, pin, remember })
      // The session cookie is set; load the app (server layouts read the cookie).
      router.replace('/dashboard')
      router.refresh()
      return
    } catch (err) {
      setError(errorMessage(err))
      setPin('')
      pinRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const shopName = data?.shopName ?? t('signIn')
  const features = [
    { icon: ScanBarcode, title: t('feature1Title') },
    { icon: Boxes, title: t('feature2Title') },
    { icon: Wallet, title: t('feature3Title') },
  ]
  const bars = [38, 52, 44, 66, 58, 78, 92]

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[1.12fr_1fr]">
      {/* Left: midnight aurora with a floating glass preview (desktop only). */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#090d16] via-[#12113a] to-[#1e1b4b] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="animate-drift pointer-events-none absolute -top-32 -left-24 size-[34rem] rounded-full bg-indigo-500/45 blur-[110px]" aria-hidden />
        <div className="animate-drift pointer-events-none absolute -right-28 bottom-[-9rem] size-[36rem] rounded-full bg-violet-600/45 blur-[120px] [animation-delay:-6s]" aria-hidden />
        <div className="animate-drift pointer-events-none absolute top-1/3 right-1/4 size-72 rounded-full bg-emerald-400/15 blur-[100px] [animation-delay:-11s]" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(80% 70% at 50% 40%, #000, transparent)',
            WebkitMaskImage: 'radial-gradient(80% 70% at 50% 40%, #000, transparent)',
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <div className="bg-brand shadow-glow flex size-10 items-center justify-center rounded-xl ring-1 ring-white/25">
            <Store className="size-5" aria-hidden />
          </div>
          <span className="text-lg font-semibold tracking-tight">{shopName}</span>
        </div>

        {/* Glass preview card: example data only. */}
        <div className="relative mx-auto my-8 w-full max-w-md">
          <div className="animate-float-slow">
            <div className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-wider text-indigo-200/80 uppercase">{t('previewToday')}</p>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">{t('previewSample')}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-extrabold tracking-tight">৳ 48,250</p>
                  <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    <TrendingUp className="size-3" aria-hidden /> +12%
                  </p>
                </div>
                <div className="flex h-16 items-end gap-1.5" aria-hidden>
                  {bars.map((h, i) => (
                    <span
                      key={i}
                      className={`w-2.5 rounded-t-md ${i === bars.length - 1 ? 'bg-gradient-to-t from-violet-500 to-indigo-300 shadow-[0_0_14px_rgb(129_140_248/0.7)]' : 'bg-white/20'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {/* Receipt overlapping the card. */}
            <div className="relative -mt-4 ml-10 -rotate-2 rounded-2xl border border-white/20 bg-white/90 p-4 text-slate-800 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                <span className="inline-flex items-center gap-1.5">
                  <Receipt className="size-3.5" aria-hidden /> {t('previewReceipt')}
                </span>
                <span>#1042</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {[
                  [t('previewItem1'), '৳ 780'],
                  [t('previewItem2'), '৳ 190'],
                  [t('previewItem3'), '৳ 120'],
                ].map(([name, price]) => (
                  <li key={name} className="flex justify-between gap-3">
                    <span className="truncate text-slate-600">{name}</span>
                    <span className="font-medium">{price}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-300 pt-3">
                <span className="text-sm font-semibold">{t('previewTotal')}</span>
                <span className="text-base font-extrabold">৳ 1,090</span>
              </div>
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <Check className="size-3" aria-hidden /> {t('previewPaid')}
              </p>
            </div>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-3xl leading-tight font-extrabold tracking-tight text-balance xl:text-4xl">{t('tagline')}</h1>
          <ul className="mt-5 flex flex-wrap gap-2">
            {features.map((f) => (
              <li key={f.title} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm text-slate-200 backdrop-blur">
                <f.icon className="size-4 text-indigo-300" aria-hidden />
                {f.title}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right: the form. */}
      <div className="relative flex items-center justify-center overflow-hidden p-4 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-violet-400/20 blur-3xl lg:hidden" aria-hidden />
        <div className="absolute top-4 right-4">
          <LanguageSwitcher compact={false} />
        </div>
        <div className="relative w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="bg-brand shadow-glow flex size-12 items-center justify-center rounded-2xl text-white ring-1 ring-white/30">
              <Store className="size-6" aria-hidden />
            </div>
            <p className="text-lg font-bold tracking-tight">{shopName}</p>
          </div>
          <div className="rounded-3xl border border-[var(--card-edge)] bg-card p-6 shadow-[var(--shadow-card)] ring-1 ring-[var(--card-ring)] sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0">
            <h2 className="text-3xl font-extrabold tracking-tight">{t('welcomeBack')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('enterCredentials')}</p>
            <form onSubmit={submit} className="mt-7 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <div className="group relative">
                  <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" aria-hidden />
                  <Input
                    id="username"
                    className="h-12 rounded-xl border-transparent bg-white pl-10 shadow-[0_2px_10px_-4px_rgb(15_23_42/0.12)] ring-1 ring-slate-900/10 transition-all focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)] focus-visible:ring-primary dark:bg-input/30 dark:ring-white/10"
                    placeholder={t('usernamePlaceholder')}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">{t('pin')}</Label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" aria-hidden />
                  <Input
                    id="pin"
                    ref={pinRef}
                    className="h-12 rounded-xl border-transparent bg-white pr-12 pl-10 shadow-[0_2px_10px_-4px_rgb(15_23_42/0.12)] ring-1 ring-slate-900/10 transition-all focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)] focus-visible:ring-primary dark:bg-input/30 dark:ring-white/10"
                    placeholder={t('pinPlaceholder')}
                    type={showPin ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    aria-label={showPin ? t('hidePin') : t('showPin')}
                    aria-pressed={showPin}
                    className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {showPin ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
                {error && (
                  <p id="login-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">
                  {t('remember')}
                </Label>
              </div>
              <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base transition-transform hover:-translate-y-0.5" disabled={busy || !username || !pin}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? t('signingIn') : t('signIn')}
                {!busy && <ArrowRight className="size-4" aria-hidden />}
              </Button>
            </form>
            {demo && (
              <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-primary/20 bg-primary/[0.06] p-2 pl-3.5">
                <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-semibold">{t('demoQuick')}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {demo.username} · {demo.password}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    setUsername(demo.username)
                    setPin(demo.password)
                    setError(null)
                    pinRef.current?.focus()
                  }}
                >
                  {t('demoFill')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
