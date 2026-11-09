/**
 * Barcode encoders for label printing. Output is a string of modules: '1' = bar, '0' = space.
 * Rendering (SVG) lives in components/common/barcode-svg.tsx.
 *
 * - EAN-13: retail standard; 12 data digits + check digit.
 * - Code 128: any printable ASCII; uses code set C for long digit runs (denser labels).
 *
 * Scanning needs no code here: USB scanners type the digits like a keyboard.
 */

export type BarcodeFormat = 'EAN13' | 'CODE128'

// ---------------------------------------------------------------- EAN-13

/** Check digit for the first 12 digits of an EAN-13 code. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs exactly 12 data digits')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const invert = (s: string) => s.replace(/./g, (c) => (c === '1' ? '0' : '1'))
const EAN_R = EAN_L.map(invert)
const EAN_G = EAN_R.map((s) => [...s].reverse().join(''))
/** Parity of the left half, chosen by the first digit. */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** 95 modules: guard + 6 left digits + centre guard + 6 right digits + guard. */
export function encodeEan13(code: string): string {
  if (!isValidEan13(code)) throw new Error(`"${code}" is not a valid EAN-13 code`)
  const d = [...code].map(Number)
  const parity = EAN_PARITY[d[0]]
  let out = '101'
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]]
  out += '01010'
  for (let i = 7; i <= 12; i++) out += EAN_R[d[i]]
  return out + '101'
}

// ---------------------------------------------------------------- Code 128

/** Bar/space widths for symbol values 0–105, then STOP (106). Each sums to 11 modules (stop: 13). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

/** Printable ASCII only (code set B). Scanners and label printers handle this reliably. */
export function isCode128Encodable(value: string): boolean {
  return value.length > 0 && /^[\x20-\x7e]+$/.test(value)
}

/** Symbol values (start, data, checksum, stop) for `value`. Exported for tests. */
export function code128Symbols(value: string): number[] {
  if (!isCode128Encodable(value)) throw new Error('Code 128 labels support printable ASCII characters only')
  const symbols: number[] = []
  let set: 'B' | 'C' | null = null
  let i = 0
  // Use set C for runs of ≥ 4 digits (≥ 2 at the very start/end would also qualify, but 4 keeps it simple and valid).
  const digitRun = (from: number) => {
    let j = from
    while (j < value.length && value[j] >= '0' && value[j] <= '9') j++
    return j - from
  }
  while (i < value.length) {
    const run = digitRun(i)
    if (run >= 4 || (run >= 2 && run === value.length - i && run % 2 === 0 && set === null)) {
      const pairs = Math.floor(run / 2)
      if (set !== 'C') {
        symbols.push(set === null ? START_C : CODE_C)
        set = 'C'
      }
      for (let k = 0; k < pairs; k++) {
        symbols.push(Number(value.slice(i, i + 2)))
        i += 2
      }
      continue
    }
    if (set !== 'B') {
      symbols.push(set === null ? START_B : CODE_B)
      set = 'B'
    }
    symbols.push(value.charCodeAt(i) - 32)
    i++
  }
  let checksum = symbols[0]
  for (let k = 1; k < symbols.length; k++) checksum += symbols[k] * k
  symbols.push(checksum % 103, STOP)
  return symbols
}

export function encodeCode128(value: string): string {
  let out = ''
  for (const s of code128Symbols(value)) {
    const widths = CODE128_PATTERNS[s]
    for (let k = 0; k < widths.length; k++) out += (k % 2 === 0 ? '1' : '0').repeat(Number(widths[k]))
  }
  return out
}

/** Encode with the preferred format, falling back to Code 128 when the value is not a valid EAN-13. */
export function encodeBarcode(value: string, preferred: BarcodeFormat): { format: BarcodeFormat; modules: string } {
  if (preferred === 'EAN13' && isValidEan13(value)) return { format: 'EAN13', modules: encodeEan13(value) }
  return { format: 'CODE128', modules: encodeCode128(value) }
}

/**
 * In-store EAN-13: prefix "2" is reserved for internal use, so generated codes never collide
 * with manufacturer barcodes printed on packaging.
 */
export function makeInStoreEan13(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 99_999_999_999) throw new Error('Sequence out of range')
  const first12 = '2' + String(sequence).padStart(11, '0')
  return first12 + ean13CheckDigit(first12)
}
