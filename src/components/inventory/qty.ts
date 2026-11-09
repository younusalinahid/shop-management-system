import type { BaseQty } from '@/types/db'
import { bestDisplayUnit, formatQty, type UnitLike } from '@/lib/units'

/** A base quantity in the largest unit that shows it as a whole number ("5 Sack", "1.5 KG" → "1,500 Gram"). */
export function qtyText(base: BaseQty, units: readonly UnitLike[], baseUnitName: string): string {
  const unit = bestDisplayUnit(base, units)
  return unit ? formatQty(base, unit) : `${base.toLocaleString('en-IN')} ${baseUnitName}`
}

/** Signed change: "+5 Sack", "−1,500 Gram". */
export function qtyChangeText(change: BaseQty, units: readonly UnitLike[], baseUnitName: string): string {
  const text = qtyText(Math.abs(change), units, baseUnitName)
  return `${change < 0 ? '−' : '+'}${text}`
}
