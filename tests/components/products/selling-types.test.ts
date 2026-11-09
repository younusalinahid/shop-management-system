import { describe, expect, it } from 'vitest'
import { buildTemplateUnits, DEFAULT_SETUP, detectSetup, type UnitRowLike } from '@/components/products/selling-types'

/** Base factors the way the form computes them: qty × the referenced row's factor. */
function factorsOf(units: UnitRowLike[]) {
  const map = new Map<string, number>()
  for (const [i, u] of units.entries()) map.set(u.key, i === 0 ? 1 : Number(u.qty) * (map.get(u.of) ?? NaN))
  return map
}

describe('selling templates', () => {
  it('builds piece + packet + carton (24 packets of 12 pieces)', () => {
    const units = buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'pack', packName: 'Packet', packSize: '12', bigPackName: 'Carton', bigPackSize: '24' }, [])
    expect(units.map((u) => u.name)).toEqual(['Piece', 'Packet', 'Carton'])
    expect([...factorsOf(units).values()]).toEqual([1, 12, 288])
  })

  it('builds weight with grams hidden from selling', () => {
    const units = buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'weight', sackSize: '25' }, [])
    expect(units.map((u) => [u.name, u.canSell])).toEqual([
      ['Gram', false],
      ['KG', true],
      ['Sack', true],
    ])
    expect([...factorsOf(units).values()]).toEqual([1, 1000, 25_000])
  })

  it('keeps ids and prices of units that still exist when the setup changes', () => {
    const first = buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'pack', packSize: '35' }, [])
    first[1].retail = '33'
    const second = buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'pack', packSize: '40' }, first)
    expect(second[0].key).toBe(first[0].key)
    expect(second[1].key).toBe(first[1].key)
    expect(second[1].retail).toBe('33')
  })

  it('recognises saved products so editing opens the simple view', () => {
    // Saved products load with every unit expressed directly in base units.
    const flat = (units: UnitRowLike[]) => {
      const f = factorsOf(units)
      return units.map((u, i) => ({ ...u, qty: String(f.get(u.key)), of: i === 0 ? '' : units[0].key }))
    }
    const pack = flat(buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'pack', packSize: '12', bigPackName: 'Carton', bigPackSize: '24' }, []))
    expect(detectSetup(pack, factorsOf(pack))).toMatchObject({ kind: 'pack', packSize: '12', bigPackName: 'Carton', bigPackSize: '24' })

    const rice = flat(buildTemplateUnits({ ...DEFAULT_SETUP, kind: 'weight', sackSize: '37.5' }, []))
    expect(detectSetup(rice, factorsOf(rice))).toMatchObject({ kind: 'weight', sackSize: '37.5' })

    const odd = flat([{ ...buildTemplateUnits(DEFAULT_SETUP, [])[0], name: 'Meter' }])
    expect(detectSetup(odd, factorsOf(odd)).kind).toBe('custom')
  })
})
