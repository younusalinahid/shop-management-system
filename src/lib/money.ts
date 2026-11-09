import type { BasisPoints, Money } from '@/types/db'
import { DecimalError, divRound, integerToDecimalString, mulToInteger, parseDecimal } from './decimal'

/**
 * Money is always an integer number of poisha (1 BDT = 100 poisha).
 * All arithmetic here is integer-exact; rounding happens only at explicit points.
 */

export const POISHA_PER_TAKA = 100

/** "1,250.50" | 1250.5 -> 125050. Throws on more than 2 decimal places or invalid input. */
export function parseMoney(input: string | number): Money {
  const d = parseDecimal(input)
  if (d.scale > 2) throw new DecimalError('Amount can have at most 2 decimal places')
  return mulToInteger(d, POISHA_PER_TAKA, 'exact')
}

/** Like parseMoney but returns null instead of throwing (for form inputs). */
export function tryParseMoney(input: string | number | null | undefined): Money | null {
  if (input === null || input === undefined || String(input).trim() === '') return null
  try {
    return parseMoney(input)
  } catch {
    return null
  }
}

/** 125050 -> "1250.5" (plain, for editable inputs). */
export function moneyToInput(amount: Money): string {
  return integerToDecimalString(amount, 2)
}

export function assertMoney(amount: number, label = 'Amount'): asserts amount is Money {
  if (!Number.isSafeInteger(amount)) throw new DecimalError(`${label} must be an integer number of poisha`)
}

/** Price (per one unit) × decimal quantity, rounded half-up to the poisha. */
export function multiplyMoney(price: Money, quantity: string | number): Money {
  assertMoney(price, 'Price')
  const q = parseDecimal(quantity)
  // price * q.units / 10^scale
  return divRound(BigInt(price) * q.units, 10n ** BigInt(q.scale))
}

/** amount × rate (basis points), rounded half-up. 15% of ৳100 -> percentOf(10000, 1500) = 1500 */
export function percentOf(amount: Money, rate: BasisPoints): Money {
  assertMoney(amount)
  return divRound(BigInt(amount) * BigInt(rate), 10000n)
}

/** Tax contained in a tax-inclusive amount: amount × rate / (10000 + rate). */
export function inclusiveTax(amount: Money, rate: BasisPoints): Money {
  assertMoney(amount)
  if (rate <= 0) return 0
  return divRound(BigInt(amount) * BigInt(rate), BigInt(10000 + rate))
}

export function sumMoney(values: readonly Money[]): Money {
  let total = 0
  for (const v of values) {
    assertMoney(v)
    total += v
  }
  assertMoney(total, 'Total')
  return total
}

/**
 * Split `total` across `weights` proportionally so that the parts sum EXACTLY to total
 * (largest-remainder method). Used to spread invoice discounts / additional costs over lines.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  assertMoney(total)
  if (weights.length === 0) return []
  const big = weights.map((w) => {
    if (!Number.isSafeInteger(w) || w < 0) throw new DecimalError('Weights must be non-negative integers')
    return BigInt(w)
  })
  const sum = big.reduce((a, b) => a + b, 0n)
  if (sum === 0n) {
    // Equal split when all weights are zero.
    return allocate(total, weights.map(() => 1))
  }
  const T = BigInt(total)
  const sign = T < 0n ? -1n : 1n
  const absT = T * sign
  const parts = big.map((w) => (absT * w) / sum)
  const remainders = big.map((w, i) => ({ i, r: (absT * w) % sum }))
  let leftover = absT - parts.reduce((a, b) => a + b, 0n)
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  for (let k = 0; leftover > 0n; k++, leftover--) parts[remainders[k % parts.length].i] += 1n
  return parts.map((p) => Number(p * sign))
}

// ---------------------------------------------------------------- formatting

let numberLocale = 'en-IN' // South Asian digit grouping: 12,34,567.50
let currencySymbol = '৳'

export function configureMoneyFormat(opts: { locale?: string; symbol?: string }) {
  if (opts.locale) numberLocale = opts.locale
  if (opts.symbol) currencySymbol = opts.symbol
}

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(fraction: number) {
  const key = `${numberLocale}|${fraction}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(numberLocale, { minimumFractionDigits: fraction, maximumFractionDigits: 2 })
    formatters.set(key, f)
  }
  return f
}

/**
 * 125050 -> "৳1,250.50", using South Asian grouping: 12345650 -> "৳1,23,456.50".
 * The number is rendered from an exact decimal string, never from a lossy float division.
 */
export function formatMoney(amount: Money, opts: { symbol?: boolean; fraction?: 0 | 2 } = {}): string {
  const { symbol = true, fraction = 2 } = opts
  const neg = amount < 0
  const plain = integerToDecimalString(Math.abs(amount), 2, fraction)
  // Intl formats strings exactly (ES2023 Intl.NumberFormat v3); Number() is safe for 2-dp values.
  const body = formatter(fraction).format(Number(plain))
  return `${neg ? '−' : ''}${symbol ? currencySymbol : ''}${body}`
}
