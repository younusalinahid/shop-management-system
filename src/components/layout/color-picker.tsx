'use client'

import { Check, Palette } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { DEFAULT_HUE, useThemeStore } from '@/stores/theme-store'

/** Ready-made brand colors, as hues. The slider below them reaches everything in between. */
const PRESETS = [
  { key: 'indigo', hue: DEFAULT_HUE },
  { key: 'green', hue: 155 },
  { key: 'rose', hue: 350 },
  { key: 'orange', hue: 55 },
  { key: 'sky', hue: 230 },
  { key: 'purple', hue: 315 },
  { key: 'teal', hue: 190 },
  { key: 'red', hue: 25 },
] as const

const swatch = (hue: number) => `oklch(0.6 0.2 ${hue})`

/** Lets each user pick the app's brand color. Saved in this browser only. */
export function ColorPicker() {
  const t = useTranslations('shell')
  const saved = useThemeStore((s) => s.hue)
  const hue = saved ?? DEFAULT_HUE
  const setHue = useThemeStore((s) => s.setHue)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('colorTitle')} title={t('colorTitle')}>
          <Palette className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-4">
        <p className="text-sm font-semibold">{t('colorTitle')}</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setHue(p.hue)}
              aria-label={t(`colors.${p.key}`)}
              aria-pressed={saved === p.hue}
              title={t(`colors.${p.key}`)}
              style={{ background: swatch(p.hue) }}
              className={cn(
                'flex h-9 items-center justify-center rounded-lg text-white shadow-sm ring-offset-2 ring-offset-popover transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring',
                saved === p.hue && 'ring-2 ring-foreground/70',
              )}
            >
              {saved === p.hue && <Check className="size-4" aria-hidden />}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label htmlFor="hue-slider" className="text-xs font-medium text-muted-foreground">
            {t('colorCustom')}
          </label>
          <input
            id="hue-slider"
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            className="h-3 w-full cursor-pointer appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => swatch(h)).join(', ')})` }}
          />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => setHue(null)} disabled={saved === null}>
          {t('colorReset')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
