import type { ID } from '@/types/db'
import { newId } from '@/lib/id'

/**
 * "How do you sell this product?" templates for the product form. Each template turns a few plain
 * answers (pieces per packet, KG per sack…) into the unit rows the form already understands, so the
 * shop owner never has to think about base units and conversion factors.
 *
 * Units refer to the row they contain ("1 Carton = 24 × Packet"), and the form computes base factors
 * from that, exactly as in the custom editor.
 */

export type SellingKind = 'piece' | 'pack' | 'weight' | 'liquid' | 'custom'

export interface SellingSetup {
  kind: SellingKind
  /** pack: name and pieces per pack */
  packName: string
  packSize: string
  /** pack: optional bigger package and packs per big package ('' = none) */
  bigPackName: string
  bigPackSize: string
  /** weight: optional KG per sack ('' = none) */
  sackSize: string
  /** liquid: optional bottle name and ML per bottle ('' = none) */
  bottleName: string
  bottleSize: string
}

/** Shape of a unit row in the product form (kept in sync with product-form-page.tsx). */
export interface UnitRowLike {
  key: ID
  name: string
  symbol: string
  qty: string
  of: ID
  canPurchase: boolean
  canSell: boolean
  retail: string
  wholesale: string
  purchase: string
}

export const DEFAULT_SETUP: SellingSetup = {
  kind: 'piece',
  packName: 'Packet',
  packSize: '',
  bigPackName: '',
  bigPackSize: '',
  sackSize: '',
  bottleName: 'Bottle',
  bottleSize: '',
}

/** Base unit of each template; a product with history keeps its base, so only matching templates apply. */
export const BASE_OF: Record<Exclude<SellingKind, 'custom'>, string> = {
  piece: 'Piece',
  pack: 'Piece',
  weight: 'Gram',
  liquid: 'ML',
}

/** Fractional quantities (0.5 KG) make sense for weight and liquid only. */
export const FRACTION_OF: Record<Exclude<SellingKind, 'custom'>, boolean> = { piece: false, pack: false, weight: true, liquid: true }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Build unit rows for a template. Rows whose name already exists keep their id and prices, so
 * switching packet size or adding a sack never loses typed prices, and barcodes stay linked.
 */
export function buildTemplateUnits(setup: SellingSetup, current: readonly UnitRowLike[]): UnitRowLike[] {
  if (setup.kind === 'custom') return [...current]
  const reuse = (name: string) => current.find((u) => same(u.name, name))
  const row = (name: string, symbol: string, of: ID, qty: string, sell: boolean, buy: boolean): UnitRowLike => {
    const prev = reuse(name)
    return {
      key: prev?.key ?? newId(),
      name,
      symbol: prev?.symbol || symbol,
      qty,
      of,
      canSell: sell,
      canPurchase: buy,
      // A unit that is neither sold nor bought (grams under a KG product) has no prices.
      retail: sell ? (prev?.retail ?? '') : '',
      wholesale: sell ? (prev?.wholesale ?? '') : '',
      purchase: buy ? (prev?.purchase ?? '') : '',
    }
  }
  // The base row always keeps the current base row's id (required once a product has history).
  const baseKey = current[0]?.key ?? newId()
  const base = (name: string, symbol: string, sell: boolean, buy: boolean) => ({ ...row(name, symbol, '', '1', sell, buy), key: baseKey })

  switch (setup.kind) {
    case 'piece':
      return [base('Piece', 'pc', true, true)]
    case 'pack': {
      const piece = base('Piece', 'pc', true, true)
      const pack = row(setup.packName.trim() || 'Packet', 'pkt', piece.key, setup.packSize.trim(), true, true)
      const rows = [piece, pack]
      if (setup.bigPackName.trim()) rows.push(row(setup.bigPackName.trim(), '', pack.key, setup.bigPackSize.trim(), true, true))
      return rows
    }
    case 'weight': {
      // Sold in KG with decimals (0.5 KG = 500 g); grams are only the counting unit.
      const gram = base('Gram', 'g', false, false)
      const kg = row('KG', 'kg', gram.key, '1000', true, true)
      const rows = [gram, kg]
      if (setup.sackSize.trim()) rows.push(row('Sack', 'sack', kg.key, setup.sackSize.trim(), true, true))
      return rows
    }
    case 'liquid': {
      const ml = base('ML', 'ml', false, false)
      const liter = row('Liter', 'L', ml.key, '1000', true, true)
      const rows = [ml, liter]
      if (setup.bottleSize.trim()) rows.push(row(setup.bottleName.trim() || 'Bottle', 'btl', ml.key, setup.bottleSize.trim(), true, true))
      return rows
    }
  }
}

/** Recognise which template a saved product matches, so editing shows the simple view when possible. */
export function detectSetup(units: readonly UnitRowLike[], factors: ReadonlyMap<ID, number>): SellingSetup {
  const custom = { ...DEFAULT_SETUP, kind: 'custom' as const }
  if (units.length === 0) return DEFAULT_SETUP
  const [b, u1, u2, ...rest] = units
  const f = (u?: UnitRowLike) => (u ? factors.get(u.key) : undefined)
  if (rest.length) return custom

  if (same(b.name, 'Piece') && b.canSell) {
    if (!u1) return { ...DEFAULT_SETUP, kind: 'piece' }
    const packSize = f(u1)
    if (!packSize || packSize < 2) return custom
    if (!u2) return { ...DEFAULT_SETUP, kind: 'pack', packName: u1.name, packSize: String(packSize) }
    const big = f(u2)
    if (!big || big % packSize !== 0) return custom
    return { ...DEFAULT_SETUP, kind: 'pack', packName: u1.name, packSize: String(packSize), bigPackName: u2.name, bigPackSize: String(big / packSize) }
  }
  if (same(b.name, 'Gram') && !b.canSell && u1 && same(u1.name, 'KG') && f(u1) === 1000) {
    if (!u2) return { ...DEFAULT_SETUP, kind: 'weight' }
    const sack = f(u2)
    if (!same(u2.name, 'Sack') || !sack) return custom
    return { ...DEFAULT_SETUP, kind: 'weight', sackSize: String(sack / 1000) }
  }
  if (same(b.name, 'ML') && !b.canSell && u1 && same(u1.name, 'Liter') && f(u1) === 1000) {
    if (!u2) return { ...DEFAULT_SETUP, kind: 'liquid' }
    const bottle = f(u2)
    if (!bottle) return custom
    return { ...DEFAULT_SETUP, kind: 'liquid', bottleName: u2.name, bottleSize: String(bottle) }
  }
  return custom
}
