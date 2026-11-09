/**
 * Minimal RFC 4180 CSV: quoted fields, embedded commas/quotes/newlines, CRLF or LF.
 * Exports start with a UTF-8 BOM so Excel opens Bangla text and ৳ correctly.
 */

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop fully blank lines.
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

function escapeField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  // Leading = + - @ would run as formulas in spreadsheet apps; prefix with a quote to keep them as text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return '﻿' + rows.map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n'
}

/** Rows as objects keyed by the (trimmed, lower-cased) header row. */
export function csvToObjects(text: string): Array<{ line: number; values: Record<string, string> }> {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r, i) => ({
    line: i + 2,
    // Undo the formula-guard quote added by toCsv.
    values: Object.fromEntries(header.map((h, k) => [h, (r[k] ?? '').trim().replace(/^'(?=[=+\-@])/, '')])),
  }))
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
