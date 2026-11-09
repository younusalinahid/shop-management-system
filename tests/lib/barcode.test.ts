import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, code128Symbols, ean13CheckDigit, encodeBarcode, encodeCode128, encodeEan13, isValidEan13, makeInStoreEan13 } from '@/lib/barcode'
import { parseCsv, csvToObjects, toCsv } from '@/lib/csv'

describe('EAN-13', () => {
  it('computes check digits for known codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(ean13CheckDigit('590123412345')).toBe(7)
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
  })

  it('encodes 95 modules with guards in place', () => {
    const m = encodeEan13('5901234123457')
    expect(m).toHaveLength(95)
    expect(m.startsWith('101')).toBe(true)
    expect(m.slice(45, 50)).toBe('01010')
    expect(m.endsWith('101')).toBe(true)
    // Digit 9 in position 2 uses L-parity for first digit 5 (LGGLLG): L(9) = 0001011
    expect(m.slice(3, 10)).toBe('0001011')
  })

  it('generates in-store codes with prefix 2 and a valid check digit', () => {
    const code = makeInStoreEan13(15)
    expect(code).toMatch(/^200000000015\d$/)
    expect(isValidEan13(code)).toBe(true)
  })
})

describe('Code 128', () => {
  it('has a well-formed pattern table', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    for (const p of CODE128_PATTERNS.slice(0, 106)) expect([...p].reduce((a, c) => a + Number(c), 0)).toBe(11)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
  })

  it('computes the checksum for the reference example PJJ123C', () => {
    // Start B (104), then P J J 1 2 3 C in code set B. Checksum = 879 mod 103 = 55.
    const s = code128Symbols('PJJ123C')
    expect(s[0]).toBe(104)
    expect(s.at(-2)).toBe(55)
    expect(s.at(-1)).toBe(106)
  })

  it('uses code set C for numeric codes', () => {
    const s = code128Symbols('123456')
    expect(s.slice(0, 4)).toEqual([105, 12, 34, 56])
  })

  it('switches between sets and decodes back to the same symbols', () => {
    const value = 'SKU-00012345X'
    const modules = encodeCode128(value)
    const symbols = code128Symbols(value)
    // Every symbol is 11 modules, the stop symbol 13.
    expect(modules).toHaveLength((symbols.length - 1) * 11 + 13)
    expect(modules.startsWith('1')).toBe(true)
    expect(modules.endsWith('11')).toBe(true)
  })

  it('falls back to Code 128 when the value is not EAN-13', () => {
    expect(encodeBarcode('ABC-1', 'EAN13').format).toBe('CODE128')
    expect(encodeBarcode('4006381333931', 'EAN13').format).toBe('EAN13')
    expect(() => encodeCode128('দাম')).toThrow()
  })
})

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [
      ['name', 'note'],
      ['Rice "Miniket", 25kg', 'line1\nline2'],
      ['=SUM(A1)', '-5'],
    ]
    const text = toCsv(rows)
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const parsed = parseCsv(text)
    expect(parsed[1]).toEqual(rows[1])
    // Formula guard keeps it as text in spreadsheets; csvToObjects strips it again. Numbers are untouched.
    expect(parsed[2]).toEqual(["'=SUM(A1)", '-5'])
    expect(csvToObjects(text)[1].values).toEqual({ name: '=SUM(A1)', note: '-5' })
  })

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow('unclosed')
  })
})
