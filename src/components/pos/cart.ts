import type { ID, PriceMode, Product, ProductUnit } from '@/types/db'
import { newId } from '@/lib/id'
import { moneyToInput, tryParseMoney } from '@/lib/money'
import { computeSale, unitPriceFor } from '@/lib/sales'
import { toBaseQty, UnitError } from '@/lib/units'

/**
 * POS cart state. Inputs stay as typed strings (quantities like "1.5", prices in taka) so editing is
 * natural; `cartView` turns them into exact integers with the same functions the server uses.
 */

export interface CartLine {
  key: string
  productId: ID
  unitId: ID
  quantity: string
  /** Price per unit in taka, as typed. */
  price: string
  discount: string
}

export interface Cart {
  lines: CartLine[]
  customerId?: ID
  priceMode: PriceMode
  invoiceDiscount: string
  note: string
}

export const emptyCart = (priceMode: PriceMode): Cart => ({ lines: [], priceMode, invoiceDiscount: '', note: '' })

export interface Lookup {
  product: (id: ID) => Product | undefined
  units: (productId: ID) => ProductUnit[]
}

/** Add one of `unit` (or the product's first selling unit); the same product and unit adds 1 to its quantity. */
export function addToCart(cart: Cart, product: Product, unit: ProductUnit): Cart {
  const existing = cart.lines.find((l) => l.productId === product.id && l.unitId === unit.id)
  if (existing) {
    const n = Number(existing.quantity)
    const next = Number.isFinite(n) ? String(Math.round((n + 1) * 1000) / 1000) : '1'
    return { ...cart, lines: cart.lines.map((l) => (l === existing ? { ...l, quantity: next } : l)) }
  }
  return {
    ...cart,
    lines: [...cart.lines, { key: newId(), productId: product.id, unitId: unit.id, quantity: '1', price: moneyToInput(unitPriceFor(unit, cart.priceMode)), discount: '' }],
  }
}

/** Switching retail/wholesale re-prices every line from the product's list prices. */
export function repriceCart(cart: Cart, mode: PriceMode, lookup: Lookup): Cart {
  return {
    ...cart,
    priceMode: mode,
    lines: cart.lines.map((l) => {
      const u = lookup.units(l.productId).find((x) => x.id === l.unitId)
      return u ? { ...l, price: moneyToInput(unitPriceFor(u, mode)) } : l
    }),
  }
}

export interface LineView {
  line: CartLine
  product?: Product
  unit?: ProductUnit
  sellUnits: ProductUnit[]
  baseQty?: number
  unitPrice: number | null
  discount: number | null
  qtyError?: 'invalid' | 'fraction'
  /** The line asks for more than the stock on hand. */
  short: boolean
  lineTotal: number
}

export function cartView(cart: Cart, lookup: Lookup, pricesIncludeTax: boolean) {
  const lines: LineView[] = cart.lines.map((line) => {
    const product = lookup.product(line.productId)
    const sellUnits = lookup.units(line.productId).filter((u) => u.canSell)
    const unit = sellUnits.find((u) => u.id === line.unitId)
    let baseQty: number | undefined
    let qtyError: LineView['qtyError']
    if (product && unit) {
      try {
        baseQty = toBaseQty(line.quantity, unit, product.allowFraction)
      } catch (e) {
        qtyError = e instanceof UnitError && /whole/.test(e.message) ? 'fraction' : 'invalid'
      }
    }
    return {
      line,
      product,
      unit,
      sellUnits,
      baseQty,
      unitPrice: tryParseMoney(line.price || '0'),
      discount: tryParseMoney(line.discount || '0'),
      qtyError,
      short: false,
      lineTotal: 0,
    }
  })
  // Stock check across lines of the same product (e.g. 1 Packet + 5 Piece of one chocolate).
  const wanted = new Map<ID, number>()
  for (const v of lines) if (v.baseQty !== undefined) wanted.set(v.line.productId, (wanted.get(v.line.productId) ?? 0) + v.baseQty)
  for (const v of lines) v.short = !!v.product && (wanted.get(v.line.productId) ?? 0) > v.product.stockQty

  const valid = lines.filter((v) => v.baseQty !== undefined && v.unitPrice !== null && v.discount !== null)
  const invoiceDiscount = tryParseMoney(cart.invoiceDiscount || '0')
  const calc = computeSale(
    valid.map((v) => ({ quantity: v.line.quantity, unitPrice: v.unitPrice!, discount: v.discount!, taxRate: v.product!.taxRate })),
    invoiceDiscount ?? 0,
    pricesIncludeTax,
  )
  valid.forEach((v, i) => (v.lineTotal = calc.lines[i].lineTotal))
  const ready = lines.length > 0 && valid.length === lines.length && invoiceDiscount !== null
  return { lines, calc, ready, invoiceDiscountValid: invoiceDiscount !== null }
}
