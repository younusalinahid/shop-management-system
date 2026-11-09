/**
 * Exact decimal helpers built on BigInt, used for converting user-entered decimal
 * quantities/amounts into integers without floating-point error.
 *
 *   0.1 + 0.2 !== 0.3 in JS floats, but parseDecimal('0.1') + parseDecimal('0.2') is exact.
 */

/** A decimal number represented exactly as `units / 10^scale`. */
export interface Decimal {
  units: bigint
  scale: number
}

export class DecimalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecimalError'
  }
}

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/

/**
 * Parse a user-entered decimal ("1.5", "1,250.75", 2, "  .5 ") into an exact Decimal.
 * Accepts numbers too, via their shortest round-trip string (e.g. 1.5 -> "1.5").
 * Rejects exponent notation, NaN and Infinity.
 */
export function parseDecimal(input: string | number): Decimal {
  let s: string
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new DecimalError('Number must be finite')
    s = String(input)
    if (/e/i.test(s)) {
      // Very small/large numbers: fall back to fixed with up to 20 digits, then trim.
      s = input.toFixed(20).replace(/\.?0+$/, '')
    }
  } else {
    s = input.trim().replace(/,/g, '')
  }
  const m = DECIMAL_RE.exec(s)
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
    throw new DecimalError(`"${String(input)}" is not a valid number`)
  }
  const sign = m[1] === '-' ? -1n : 1n
  const intPart = m[2] || '0'
  const fracPart = (m[3] ?? '').replace(/0+$/, '')
  const units = BigInt(intPart + fracPart) * sign
  return { units, scale: fracPart.length }
}

/** Number of decimal places the input uses (after trimming trailing zeros). */
export function decimalPlaces(input: string | number): number {
  return parseDecimal(input).scale
}

const pow10 = (n: number) => 10n ** BigInt(n)

export type RoundingMode = 'half-up' | 'exact'

/**
 * Multiply a decimal by an integer factor and return an integer.
 * - mode 'exact' throws when the result is not a whole number (e.g. 0.3333 packet × 35 pieces).
 * - mode 'half-up' rounds half away from zero (used for money).
 */
export function mulToInteger(value: string | number | Decimal, factor: number | bigint, mode: RoundingMode): number {
  const d = typeof value === 'object' ? value : parseDecimal(value)
  if (typeof factor === 'number' && !Number.isSafeInteger(factor)) {
    throw new DecimalError('Factor must be a safe integer')
  }
  const num = d.units * BigInt(factor)
  const den = pow10(d.scale)
  const q = num / den
  const r = num % den
  if (r === 0n) return toSafeNumber(q)
  if (mode === 'exact') {
    throw new DecimalError('Result is not a whole number')
  }
  const abs = r < 0n ? -r : r
  const roundAway = abs * 2n >= den
  const result = roundAway ? q + (num < 0n ? -1n : 1n) : q
  return toSafeNumber(result)
}

/** Divide two integers and round half away from zero. Exact for all safe integers. */
export function divRound(numerator: number | bigint, denominator: number | bigint): number {
  const n = BigInt(numerator)
  const d = BigInt(denominator)
  if (d === 0n) throw new DecimalError('Division by zero')
  const q = n / d
  const r = n % d
  if (r === 0n) return toSafeNumber(q)
  const abs = r < 0n ? -r : r
  const absD = d < 0n ? -d : d
  const negative = n < 0n !== d < 0n
  return toSafeNumber(abs * 2n >= absD ? q + (negative ? -1n : 1n) : q)
}

/** Format an integer `units / 10^scale` as a plain decimal string, trimming trailing zeros. */
export function integerToDecimalString(value: number, scale: number, minFraction = 0): string {
  const neg = value < 0
  const s = String(Math.abs(value)).padStart(scale + 1, '0')
  const intPart = scale > 0 ? s.slice(0, -scale) : s
  let frac = scale > 0 ? s.slice(-scale) : ''
  frac = frac.replace(/0+$/, '')
  while (frac.length < minFraction) frac += '0'
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '')
}

function toSafeNumber(v: bigint): number {
  const n = Number(v)
  if (!Number.isSafeInteger(n)) throw new DecimalError('Value is too large')
  return n
}
