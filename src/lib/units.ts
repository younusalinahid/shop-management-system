import type { BaseQty } from '@/types/db'
import { DecimalError, mulToInteger, parseDecimal } from './decimal'

/**
 * Unit conversion engine.
 *
 * Every product has ONE base unit (the smallest unit it is ever counted in: piece, gram, ml).
 * Stock and every movement are integers in that base unit. Any other unit has an integer
 * `factor` = how many base units one of it contains:
 *
 *   Chocolate  base Piece   Packet = 35
 *   Rice       base Gram    KG = 1000, Sack = 25000
 *   Oil        base ML      Liter = 1000, Bottle = 500 (configurable)
 *   Biscuits   base Piece   Packet = 12, Carton = 288 (24 packets)
 *
 * Converting a user quantity is exact: 1.5 KG -> 1500 g. A quantity that does not land on a
 * whole number of base units (0.0005 KG) is rejected, never rounded, so stock stays exact.
 */

export class UnitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnitError'
  }
}

/** Upper bound keeps qty × factor inside safe integer range for realistic stock levels. */
export const MAX_FACTOR = 1_000_000_000

export interface UnitLike {
  name: string
  factor: number
}

export function isValidFactor(factor: unknown): factor is number {
  return typeof factor === 'number' && Number.isSafeInteger(factor) && factor >= 1 && factor <= MAX_FACTOR
}

export function assertValidFactor(factor: unknown, unitName = 'Unit'): asserts factor is number {
  if (!isValidFactor(factor)) {
    throw new UnitError(`${unitName}: conversion factor must be a whole number from 1 to ${MAX_FACTOR.toLocaleString('en-US')}.`)
  }
}

/**
 * Convert a quantity entered in `unit` to integer base units.
 * - Rejects zero, negative, non-numeric and non-whole-base results.
 * - When `allowFraction` is false, only whole quantities of the unit are accepted.
 */
export function toBaseQty(quantity: string | number, unit: UnitLike, allowFraction: boolean): BaseQty {
  assertValidFactor(unit.factor, unit.name)
  let d
  try {
    d = parseDecimal(quantity)
  } catch {
    throw new UnitError(`"${String(quantity)}" is not a valid quantity.`)
  }
  if (d.units <= 0n) throw new UnitError('Quantity must be greater than zero.')
  if (!allowFraction && d.scale > 0) throw new UnitError(`This product is sold in whole ${unit.name} only.`)
  try {
    return mulToInteger(d, unit.factor, 'exact')
  } catch (e) {
    if (e instanceof DecimalError && e.message === 'Result is not a whole number') {
      throw new UnitError(`${String(quantity)} ${unit.name} is smaller than the base unit allows. Use fewer decimal places.`)
    }
    throw new UnitError('Quantity is too large.')
  }
}

/**
 * Express a base quantity in `unit` as a plain decimal string (display only).
 * Exact when it terminates within `maxDecimals`; otherwise rounded half-up.
 *   fromBaseQty(1500, KG) = "1.5", fromBaseQty(28, Packet(35)) = "0.8"
 */
export function fromBaseQty(base: BaseQty, unit: UnitLike, maxDecimals = 3): string {
  assertValidFactor(unit.factor, unit.name)
  const neg = base < 0
  const n = BigInt(Math.abs(base))
  const f = BigInt(unit.factor)
  const scale = 10n ** BigInt(maxDecimals)
  let scaled = (n * scale) / f
  if (((n * scale) % f) * 2n >= f) scaled += 1n
  const int = scaled / scale
  let frac = (scaled % scale).toString().padStart(maxDecimals, '0').replace(/0+$/, '')
  if (maxDecimals === 0) frac = ''
  const s = int.toString() + (frac ? '.' + frac : '')
  return neg && s !== '0' ? '-' + s : s
}

export interface QtyPart {
  unit: string
  qty: number
}

/**
 * Break a base quantity into whole units, largest first, with the rest in the base unit.
 *   350 pieces, [Packet 35, Piece 1] -> 10 Packet
 *   28 pieces                         -> 28 Piece
 *   100 pieces, [Carton 288, Packet 12, Piece 1] -> 8 Packet + 4 Piece
 * Units with the same factor collapse to the first one listed.
 */
export function breakdown(base: BaseQty, units: readonly UnitLike[]): QtyPart[] {
  const sorted = [...units].filter((u) => isValidFactor(u.factor)).sort((a, b) => b.factor - a.factor)
  const seen = new Set<number>()
  const ladder = sorted.filter((u) => (seen.has(u.factor) ? false : (seen.add(u.factor), true)))
  const sign = base < 0 ? -1 : 1
  let rest = Math.abs(base)
  const parts: QtyPart[] = []
  for (const u of ladder) {
    const q = Math.floor(rest / u.factor)
    if (q > 0) {
      parts.push({ unit: u.name, qty: q * sign })
      rest -= q * u.factor
    }
  }
  if (rest > 0) {
    // No unit with factor 1 was supplied; keep the remainder visible in base units.
    parts.push({ unit: 'base', qty: rest * sign })
  }
  return parts
}

/** "8 Packet + 4 Piece"; "0 Piece" for zero. */
export function formatBreakdown(base: BaseQty, units: readonly UnitLike[], baseUnitName: string): string {
  const parts = breakdown(base, units)
  if (parts.length === 0) return `0 ${baseUnitName}`
  return parts.map((p) => `${formatQtyNumber(p.qty)} ${p.unit === 'base' ? baseUnitName : p.unit}`).join(' + ')
}

/** "1,500.5" with en-IN grouping, from an exact decimal string or integer. */
export function formatQtyNumber(value: string | number): string {
  const s = String(value)
  const neg = s.startsWith('-')
  const [int, frac] = s.replace('-', '').split('.')
  const grouped = new Intl.NumberFormat('en-IN').format(BigInt(int || '0'))
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '')
}

/** "1.5 KG" for a base quantity shown in a chosen unit. */
export function formatQty(base: BaseQty, unit: UnitLike, maxDecimals = 3): string {
  return `${formatQtyNumber(fromBaseQty(base, unit, maxDecimals))} ${unit.name}`
}

/** Pick the largest unit that represents `base` as a whole number (≥ 1), else the base unit. */
export function bestDisplayUnit<T extends UnitLike>(base: BaseQty, units: readonly T[]): T | undefined {
  const sorted = [...units].sort((a, b) => b.factor - a.factor)
  return sorted.find((u) => base !== 0 && Math.abs(base) >= u.factor && base % u.factor === 0) ?? sorted[sorted.length - 1]
}

// ---------------------------------------------------------------- presets

export interface BaseUnitPreset {
  name: string
  symbol: string
  /** Standard units that convert from this base with a fixed factor. */
  standard: Array<{ name: string; symbol: string; factor: number }>
  /** Whether fractional selling quantities usually make sense. */
  allowFraction: boolean
}

export const BASE_UNIT_PRESETS: readonly BaseUnitPreset[] = [
  { name: 'Piece', symbol: 'pc', standard: [{ name: 'Dozen', symbol: 'dz', factor: 12 }], allowFraction: false },
  { name: 'Gram', symbol: 'g', standard: [{ name: 'KG', symbol: 'kg', factor: 1000 }], allowFraction: true },
  { name: 'ML', symbol: 'ml', standard: [{ name: 'Liter', symbol: 'L', factor: 1000 }], allowFraction: true },
  { name: 'CM', symbol: 'cm', standard: [{ name: 'Meter', symbol: 'm', factor: 100 }], allowFraction: true },
]

/** Common package names offered as suggestions; their factor is product-specific. */
export const PACKAGE_UNIT_SUGGESTIONS = ['Packet', 'Box', 'Carton', 'Sack', 'Bottle', 'Can', 'Jar', 'Bag', 'Strip', 'Roll', 'Pair', 'Set']
