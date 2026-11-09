import { describe, expect, it } from 'vitest'
import { DecimalError, divRound, integerToDecimalString, mulToInteger, parseDecimal } from '@/lib/decimal'
import { allocate, formatMoney, inclusiveTax, moneyToInput, multiplyMoney, parseMoney, percentOf, sumMoney, tryParseMoney } from '@/lib/money'

describe('decimal', () => {
  it('parses decimals exactly', () => {
    expect(parseDecimal('1.5')).toEqual({ units: 15n, scale: 1 })
    expect(parseDecimal('1,250.750')).toEqual({ units: 125075n, scale: 2 })
    expect(parseDecimal(0.1)).toEqual({ units: 1n, scale: 1 })
    expect(parseDecimal('.5')).toEqual({ units: 5n, scale: 1 })
    expect(parseDecimal('-2')).toEqual({ units: -2n, scale: 0 })
  })

  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '1.2.3', '1e5', '.', NaN, Infinity]) {
      expect(() => parseDecimal(bad as string)).toThrow(DecimalError)
    }
  })

  it('converts units without float error', () => {
    // 1.5 KG -> 1500 g, 0.1 + 0.2 style problems do not occur
    expect(mulToInteger('1.5', 1000, 'exact')).toBe(1500)
    expect(mulToInteger('1.25', 1000, 'exact')).toBe(1250)
    expect(mulToInteger('0.001', 1000, 'exact')).toBe(1)
    expect(mulToInteger(1.005, 1000, 'exact')).toBe(1005)
    expect(mulToInteger('2', 35, 'exact')).toBe(70)
  })

  it('throws in exact mode when the result is fractional', () => {
    expect(() => mulToInteger('0.5', 35, 'exact')).toThrow('not a whole number')
    expect(() => mulToInteger('0.0001', 1000, 'exact')).toThrow()
  })

  it('rounds half away from zero', () => {
    expect(mulToInteger('0.125', 100, 'half-up')).toBe(13)
    expect(mulToInteger('-0.125', 100, 'half-up')).toBe(-13)
    expect(divRound(5, 2)).toBe(3)
    expect(divRound(-5, 2)).toBe(-3)
    expect(divRound(4, 3)).toBe(1)
    expect(() => divRound(1, 0)).toThrow()
  })

  it('formats integers as decimal strings', () => {
    expect(integerToDecimalString(125050, 2)).toBe('1250.5')
    expect(integerToDecimalString(5, 2, 2)).toBe('0.05')
    expect(integerToDecimalString(-1500, 3)).toBe('-1.5')
    expect(integerToDecimalString(0, 2)).toBe('0')
  })
})

describe('money', () => {
  it('parses taka into poisha', () => {
    expect(parseMoney('1250.50')).toBe(125050)
    expect(parseMoney(0.1)).toBe(10)
    expect(parseMoney('1,00,000')).toBe(10_000_000)
    expect(() => parseMoney('1.005')).toThrow('2 decimal places')
    expect(tryParseMoney('')).toBeNull()
    expect(tryParseMoney('x')).toBeNull()
    expect(moneyToInput(125050)).toBe('1250.5')
  })

  it('multiplies price by fractional quantity', () => {
    // ৳65.00/KG × 1.5 KG = ৳97.50
    expect(multiplyMoney(6500, '1.5')).toBe(9750)
    // ৳1/piece × 7
    expect(multiplyMoney(100, 7)).toBe(700)
    // ৳33.33 × 0.333 = 11.09889 -> ৳11.10
    expect(multiplyMoney(3333, '0.333')).toBe(1110)
    expect(() => multiplyMoney(10.5, 1)).toThrow()
  })

  it('computes percentages and inclusive tax', () => {
    expect(percentOf(10000, 1500)).toBe(1500)
    expect(percentOf(999, 750)).toBe(75) // 74.925 -> 75
    // ৳115 incl. 15% VAT contains ৳15 tax
    expect(inclusiveTax(11500, 1500)).toBe(1500)
    expect(inclusiveTax(11500, 0)).toBe(0)
  })

  it('sums the classic float trap exactly', () => {
    expect(sumMoney([parseMoney('0.1'), parseMoney('0.2')])).toBe(parseMoney('0.3'))
  })

  it('allocates without losing a poisha', () => {
    const parts = allocate(100, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(parts).toEqual([34, 33, 33])
    expect(allocate(1000, [3000, 7000])).toEqual([300, 700])
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-100)
    expect(allocate(10, [0, 0])).toEqual([5, 5])
    expect(allocate(10, [])).toEqual([])
  })

  it('formats with BDT symbol and South Asian grouping', () => {
    expect(formatMoney(12345650)).toBe('৳1,23,456.50')
    expect(formatMoney(-500)).toBe('−৳5.00')
    expect(formatMoney(100, { symbol: false })).toBe('1.00')
  })
})
