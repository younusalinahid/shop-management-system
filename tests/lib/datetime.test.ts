import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, endOfDay, formatDate, formatDateOnly, formatDateTime, startOfDateOnly, startOfDay, toDateOnly } from '@/lib/datetime'

// 2026-01-15 20:30 UTC = 2026-01-16 02:30 in Dhaka (UTC+6)
const TS = Date.UTC(2026, 0, 15, 20, 30)

describe('datetime (Asia/Dhaka)', () => {
  it('formats in shop timezone as DD/MM/YYYY', () => {
    expect(formatDate(TS)).toBe('16/01/2026')
    expect(formatDateTime(TS)).toBe('16/01/2026 02:30 AM')
    expect(toDateOnly(TS)).toBe('2026-01-16')
    expect(formatDateOnly('2026-12-31')).toBe('31/12/2026')
  })

  it('computes start/end of the shop day', () => {
    // Dhaka midnight 2026-01-16 = 2026-01-15 18:00 UTC
    expect(startOfDateOnly('2026-01-16')).toBe(Date.UTC(2026, 0, 15, 18, 0))
    expect(startOfDay(TS)).toBe(Date.UTC(2026, 0, 15, 18, 0))
    expect(endOfDay(TS)).toBe(Date.UTC(2026, 0, 16, 18, 0))
  })

  it('does calendar arithmetic', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30)
  })
})
