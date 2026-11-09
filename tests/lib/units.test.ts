import { describe, expect, it } from 'vitest'
import { multiplyMoney } from '@/lib/money'
import { breakdown, fromBaseQty, formatBreakdown, formatQty, isValidFactor, toBaseQty, UnitError } from '@/lib/units'

const piece = { name: 'Piece', factor: 1 }
const packet = { name: 'Packet', factor: 35 }
const gram = { name: 'Gram', factor: 1 }
const kg = { name: 'KG', factor: 1000 }
const sack = { name: 'Sack', factor: 25_000 }
const ml = { name: 'ML', factor: 1 }
const liter = { name: 'Liter', factor: 1000 }
const bottle = { name: 'Bottle', factor: 500 }
const bPacket = { name: 'Packet', factor: 12 }
const carton = { name: 'Carton', factor: 24 * 12 }

describe('unit conversion: chocolate (1 Packet = 35 Pieces)', () => {
  it('converts purchases and sales into pieces', () => {
    expect(toBaseQty(10, packet, false)).toBe(350)
    expect(toBaseQty(1, piece, false)).toBe(1)
    expect(toBaseQty(5, piece, false)).toBe(5)
    expect(toBaseQty(1, packet, false)).toBe(35)
    expect(toBaseQty(2, packet, false)).toBe(70)
  })

  it('shows 28 pieces left after selling 7 from one packet', () => {
    const left = toBaseQty(1, packet, false) - toBaseQty(7, piece, false)
    expect(left).toBe(28)
    expect(formatBreakdown(left, [packet, piece], 'Piece')).toBe('28 Piece')
    expect(breakdown(left, [packet, piece])).toEqual([{ unit: 'Piece', qty: 28 }])
    expect(formatBreakdown(350 + 28, [packet, piece], 'Piece')).toBe('10 Packet + 28 Piece')
  })

  it('rejects fractional pieces for a whole-unit product', () => {
    expect(() => toBaseQty('1.5', packet, false)).toThrow(UnitError)
    expect(() => toBaseQty('0.5', piece, true)).toThrow('smaller than the base unit')
  })
})

describe('unit conversion: rice (base Gram, KG = 1000, Sack = 25000)', () => {
  it('converts sacks, KG and grams exactly', () => {
    expect(toBaseQty(4, sack, true)).toBe(100_000)
    expect(toBaseQty('1.5', kg, true)).toBe(1500)
    expect(toBaseQty(500, gram, true)).toBe(500)
    expect(toBaseQty(1, sack, true)).toBe(25_000)
    expect(toBaseQty('1.25', kg, true)).toBe(1250)
    expect(toBaseQty('0.1', kg, true) + toBaseQty('0.2', kg, true)).toBe(toBaseQty('0.3', kg, true))
  })

  it('keeps stock exact through a sequence of sales', () => {
    let stock = toBaseQty(4, sack, true)
    stock -= toBaseQty('1.5', kg, true)
    stock -= toBaseQty(500, gram, true)
    stock -= toBaseQty(1, sack, true)
    expect(stock).toBe(73_000)
    expect(formatQty(stock, kg)).toBe('73 KG')
    expect(formatBreakdown(stock, [sack, kg, gram], 'Gram')).toBe('2 Sack + 23 KG')
  })

  it('rejects quantities finer than one gram', () => {
    expect(() => toBaseQty('0.0005', kg, true)).toThrow(UnitError)
  })

  it('prices a fractional quantity with the unit price', () => {
    // ৳78.00 per KG × 1.5 KG = ৳117.00
    expect(multiplyMoney(7800, '1.5')).toBe(11_700)
  })
})

describe('unit conversion: oil and biscuits', () => {
  it('oil: ML, Liter and a configurable bottle', () => {
    expect(toBaseQty(1, liter, true)).toBe(1000)
    expect(toBaseQty(2, bottle, true)).toBe(1000)
    expect(toBaseQty('0.25', liter, true)).toBe(250)
    expect(fromBaseQty(1750, liter)).toBe('1.75')
    expect(fromBaseQty(1750, ml)).toBe('1750')
  })

  it('biscuits: 1 Carton = 24 Packets = 288 Pieces', () => {
    expect(toBaseQty(1, carton, false)).toBe(288)
    expect(toBaseQty(3, bPacket, false)).toBe(36)
    expect(formatBreakdown(288 + 100, [carton, bPacket, piece], 'Piece')).toBe('1 Carton + 8 Packet + 4 Piece')
  })
})

describe('unit validation and display', () => {
  it('validates conversion factors', () => {
    expect(isValidFactor(35)).toBe(true)
    expect(isValidFactor(0)).toBe(false)
    expect(isValidFactor(-5)).toBe(false)
    expect(isValidFactor(2.5)).toBe(false)
    expect(isValidFactor(Number.NaN)).toBe(false)
    expect(() => toBaseQty(1, { name: 'Bad', factor: 0 }, false)).toThrow('conversion factor')
  })

  it('rejects zero, negative and garbage quantities', () => {
    expect(() => toBaseQty(0, piece, false)).toThrow('greater than zero')
    expect(() => toBaseQty(-1, piece, false)).toThrow('greater than zero')
    expect(() => toBaseQty('abc', piece, false)).toThrow('not a valid quantity')
  })

  it('formats partial packages with bounded decimals', () => {
    expect(fromBaseQty(28, packet)).toBe('0.8')
    expect(fromBaseQty(1, { name: 'x', factor: 3 })).toBe('0.333')
    expect(fromBaseQty(2, { name: 'x', factor: 3 })).toBe('0.667')
    expect(fromBaseQty(-1500, kg)).toBe('-1.5')
    expect(formatQty(1_250_000, kg)).toBe('1,250 KG')
    expect(formatBreakdown(0, [packet, piece], 'Piece')).toBe('0 Piece')
  })
})
