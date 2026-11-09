import type { DateOnly, Timestamp } from '@/types/db'

/**
 * Date helpers pinned to the shop timezone (Asia/Dhaka by default), independent of the
 * device timezone. "Today" in reports always means today in the shop's timezone.
 */

let shopTimeZone = 'Asia/Dhaka'

export function configureTimeZone(tz: string) {
  shopTimeZone = tz
}
export function getTimeZone() {
  return shopTimeZone
}

function parts(ts: Timestamp, tz = shopTimeZone) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const out: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ts))) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** DD/MM/YYYY in shop timezone. */
export function formatDate(ts: Timestamp): string {
  const p = parts(ts)
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`
}

/** DD/MM/YYYY hh:mm AM/PM in shop timezone. */
export function formatDateTime(ts: Timestamp): string {
  const p = parts(ts)
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  return `${formatDate(ts)} ${pad(h12)}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`
}

/** 'YYYY-MM-DD' (shop timezone) for a timestamp. */
export function toDateOnly(ts: Timestamp): DateOnly {
  const p = parts(ts)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Format a stored DateOnly ('YYYY-MM-DD') as DD/MM/YYYY without any timezone shifting. */
export function formatDateOnly(d: DateOnly): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

/** Offset (ms) of the shop timezone from UTC at a given instant. */
function tzOffsetMs(ts: Timestamp): number {
  const p = parts(ts)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ts / 1000) * 1000
}

/** Epoch ms of 00:00:00.000 on the given calendar date in the shop timezone. */
export function startOfDateOnly(d: DateOnly): Timestamp {
  const [y, m, day] = d.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, day)
  // Two passes handle DST transitions in zones that have them (Dhaka has none).
  let ts = guess - tzOffsetMs(guess)
  ts = guess - tzOffsetMs(ts)
  return ts
}

export function startOfDay(ts: Timestamp): Timestamp {
  return startOfDateOnly(toDateOnly(ts))
}

/** Exclusive end: start of the following day. */
export function endOfDay(ts: Timestamp): Timestamp {
  return startOfDateOnly(addDays(toDateOnly(ts), 1))
}

export function addDays(d: DateOnly, days: number): DateOnly {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function todayDateOnly(now: Timestamp = Date.now()): DateOnly {
  return toDateOnly(now)
}

/** Whole days from `from` to `to` (DateOnly strings). */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  const a = Date.UTC(...(from.split('-').map(Number) as [number, number, number]))
  const b = Date.UTC(...(to.split('-').map(Number) as [number, number, number]))
  return Math.round((b - a) / 86_400_000)
}

export const NO_EXPIRY: DateOnly = '9999-12-31'
