import Papa from 'papaparse'
import type { ApiIssue } from './types'
import { formatCount, formatINR } from './workflow/describe'
import { checkDate } from './dates'
import { LIMITS, type ColumnType, type Row } from './workflow/schema'

// Browser-safe CSV handling: the editor uses inferColumns() on a sample file
// without uploading it; the server uses parseForContract() on every run.

export class CsvError extends Error {
  readonly status: 413 | 422
  readonly code: 'FILE_TOO_LARGE' | 'INVALID_FILE'
  readonly issues: ApiIssue[]
  constructor(status: 413 | 422, message: string, issues: ApiIssue[] = []) {
    super(message)
    this.name = 'CsvError'
    this.status = status
    this.code = status === 413 ? 'FILE_TOO_LARGE' : 'INVALID_FILE'
    this.issues = issues
  }
}

export type CsvInput = string | ArrayBuffer | Uint8Array

export type ParsedTable = {
  headers: string[]
  /** Non-blank data records with their 1-based line numbers (the header is line 1). */
  records: Array<{ line: number; cells: string[] }>
  /** Records whose field count doesn't match the header. */
  issues: ApiIssue[]
}

function byteLength(input: CsvInput): number {
  if (typeof input === 'string') return new TextEncoder().encode(input).byteLength
  return input.byteLength
}

const SAVE_AS_UTF8 = 'In Excel use File → Save As → “CSV UTF-8 (Comma delimited)”; in Google Sheets use File → Download → CSV.'

/**
 * Bytes must be UTF-8. Anything else (Windows Excel's plain "CSV" is
 * Windows-1252) is rejected instead of silently turning letters into "�",
 * which would make text never match a filter.
 */
function decode(input: CsvInput): string {
  if (typeof input === 'string') return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const message = `This file is saved as UTF-16 ("Unicode Text"), not CSV. ${SAVE_AS_UTF8}`
    throw new CsvError(422, message, [{ path: 'file', line: 1, message }])
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const loose = new TextDecoder('utf-8').decode(bytes)
    const at = loose.indexOf('�')
    const line = loose.slice(0, at).split('\n').length
    const lineText = loose.split('\n')[line - 1]?.replace(/\r$/, '').slice(0, 80) ?? ''
    const message = `Line ${line} has characters that aren't UTF-8 (“${lineText}”)`
    throw new CsvError(422, `This file isn't saved as UTF-8 text, so some letters can't be read. ${SAVE_AS_UTF8}`, [
      { path: 'file', line, message },
    ])
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** A header that differs from a required column only by capitals, spaces, hyphens or underscores. */
export function similarHeader(column: string, headers: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
  return headers.find((h) => h !== column && norm(h) === norm(column))
}

/** "Missing required columns: status (the file has "Status"), region", shared by the server and the browser pre-check. */
export function missingColumnsMessage(missing: string[], headers: string[]): string {
  let near = false
  const described = missing.map((column) => {
    const similar = similarHeader(column, headers)
    if (!similar) return column
    near = true
    return `${column} (the file has "${similar}")`
  })
  const base = `Missing required column${missing.length > 1 ? 's' : ''}: ${described.join(', ')}`
  return near ? `${base}. Column names must match exactly, including capitals` : base
}

const isBlank = (cells: string[]) => cells.every((c) => c.trim() === '')

/** Keeps the first `LIMITS.issuesMax` issues and says how many there were. */
function issueSummary(what: string, issues: ApiIssue[]): { message: string; issues: ApiIssue[] } {
  const total = issues.length
  const shown = issues.slice(0, LIMITS.issuesMax)
  const message =
    total > shown.length
      ? `${what} has ${formatCount(total)} problems; the first ${shown.length} are listed.`
      : `${what} has ${total === 1 ? 'a problem' : `${total} problems`}.`
  return { message, issues: shown }
}

/**
 * Parses CSV text with our own header handling. Throws CsvError for problems
 * that make the file unusable (size, empty, header, row/column limits).
 */
export function parseTable(input: CsvInput): ParsedTable {
  if (byteLength(input) > LIMITS.fileBytes) {
    throw new CsvError(413, `The file is larger than the 1 MiB limit.`)
  }
  const text = decode(input)
  const parsed = Papa.parse<string[]>(text, { header: false, delimiter: ',', skipEmptyLines: false })
  const rows = parsed.data

  // The header is the first non-blank line.
  const headerIndex = rows.findIndex((cells) => !isBlank(cells))
  if (headerIndex === -1) throw new CsvError(422, 'The file is empty.', [{ path: 'file', message: 'The file has no header row' }])

  const headers = rows[headerIndex]!.map((h) => h.trim())
  // One "column" holding several names means another separator (Excel in many
  // locales saves with semicolons; "Unicode Text" uses tabs).
  if (headers.length === 1) {
    const only = headers[0]!
    const separator = only.includes(';') ? 'semicolons (;)' : only.includes('\t') ? 'tabs' : null
    if (separator) {
      const message = `This file separates values with ${separator}, not commas. ${SAVE_AS_UTF8}`
      throw new CsvError(422, message, [{ path: 'file', line: headerIndex + 1, message: `The header row is separated by ${separator}` }])
    }
  }
  if (headers.length > LIMITS.columns) {
    throw new CsvError(422, `The file has ${headers.length} columns; the limit is ${LIMITS.columns}.`, [
      { path: 'file', line: headerIndex + 1, message: `The file has ${headers.length} columns; the limit is ${LIMITS.columns}` },
    ])
  }

  const headerIssues: ApiIssue[] = []
  const firstSeen = new Map<string, number>()
  headers.forEach((h, i) => {
    if (h === '') {
      // Empty trailing headers usually come from a stray comma at the end of every line.
      const trailing = headers.slice(i).every((rest) => rest === '')
      headerIssues.push({
        path: 'file',
        line: headerIndex + 1,
        message: trailing
          ? `Column ${i + 1} has an empty header (usually an extra comma at the end of each line: delete that empty column and save again)`
          : `Column ${i + 1} has an empty header`,
      })
      return
    }
    const earlier = firstSeen.get(h)
    if (earlier !== undefined) {
      headerIssues.push({ path: 'file', line: headerIndex + 1, column: h, message: `Duplicate header "${h}" (columns ${earlier + 1} and ${i + 1})` })
    } else firstSeen.set(h, i)
  })
  if (headerIssues.length) {
    const { message, issues } = issueSummary('The header row', headerIssues)
    throw new CsvError(422, message, issues)
  }

  const records: ParsedTable['records'] = []
  const issues: ApiIssue[] = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i]!
    if (isBlank(cells)) continue
    const line = i + 1
    if (cells.length !== headers.length) {
      issues.push({ path: 'file', line, message: `Line ${line} has ${cells.length} field${cells.length === 1 ? '' : 's'}; expected ${headers.length}` })
      continue
    }
    records.push({ line, cells })
  }

  const dataRows = records.length + issues.length
  if (dataRows > LIMITS.rows) {
    throw new CsvError(422, `The file has ${formatCount(dataRows)} data rows; the limit is ${formatCount(LIMITS.rows)}.`, [
      { path: 'file', message: `The file has ${formatCount(dataRows)} data rows; the limit is ${formatCount(LIMITS.rows)}` },
    ])
  }

  // Quote problems Papa found (e.g. an unclosed quote) are reported with their line.
  for (const err of parsed.errors) {
    if (err.code === 'UndetectableDelimiter') continue
    const line = typeof err.row === 'number' ? err.row + 1 : undefined
    issues.push({ path: 'file', ...(line ? { line } : {}), message: `${line ? `Line ${line}: ` : ''}${err.message}` })
  }

  return { headers, records, issues }
}

export type AmountCheck = { ok: true; value: number } | { ok: false; problem: string }

/** Whole rupees only: digits, no separators, no decimals, no sign, at most ₹1,00,00,000. */
export function checkAmount(raw: string): AmountCheck {
  const s = raw.trim()
  if (s === '') return { ok: false, problem: 'is blank; every row needs an amount (blanks are not treated as zero)' }
  if (/^\d+$/.test(s)) {
    const value = Number(s)
    if (s.replace(/^0+/, '').length > 9 || value > LIMITS.amountMax) {
      return { ok: false, problem: `${s} is over the ${formatINR(LIMITS.amountMax)} limit per row` }
    }
    return { ok: true, value }
  }
  if (/^-\s*[\d.,\s]*\d/.test(s)) return { ok: false, problem: `"${s}" is negative; amounts must be zero or more` }
  if (/^\d[\d,]*\.\d+$/.test(s)) return { ok: false, problem: `"${s}" has decimals; use whole rupees (nothing is rounded)` }
  if (/^\d{1,3}([,_' ]\d{2,3})+$/.test(s) || /^\d[\d,_' ]*\d$/.test(s)) {
    return { ok: false, problem: `"${s}" contains separators; write it as ${s.replace(/[,_' ]/g, '')}` }
  }
  if (/^(₹|rs\.?|inr)\s*/i.test(s)) return { ok: false, problem: `"${s}" includes a currency symbol; write just the number` }
  return { ok: false, problem: `"${s}" is not a number` }
}

/** Whole numbers (counts, quantities): digits only, no separators, decimals or sign, at most 1,00,00,00,000. */
export function checkWholeNumber(raw: string): AmountCheck {
  const s = raw.trim()
  if (s === '') return { ok: false, problem: 'is blank; every row needs a number (blanks are not treated as zero)' }
  if (/^\d+$/.test(s)) {
    const value = Number(s)
    if (s.replace(/^0+/, '').length > 10 || value > LIMITS.integerMax) {
      return { ok: false, problem: `${s} is over the ${formatCount(LIMITS.integerMax)} limit per row` }
    }
    return { ok: true, value }
  }
  if (/^-\s*[\d.,\s]*\d/.test(s)) return { ok: false, problem: `"${s}" is negative; numbers must be zero or more` }
  if (/^\d[\d,]*\.\d+$/.test(s)) return { ok: false, problem: `"${s}" has decimals; use whole numbers (nothing is rounded)` }
  if (/^\d[\d,_' ]*\d$/.test(s)) return { ok: false, problem: `"${s}" contains separators; write it as ${s.replace(/[,_' ]/g, '')}` }
  return { ok: false, problem: `"${s}" is not a whole number` }
}

export type ContractParse = {
  rows: Row[]
  headers: string[]
  /** Columns in the file that the recipe doesn't use (dropped, never stored). */
  ignoredColumns: string[]
}

/**
 * Parses a file against a recipe's input contract. Contract columns are
 * required; extra columns are dropped. Throws CsvError (413/422) with up to 20
 * line-numbered issues.
 */
export function parseForContract(input: CsvInput, contract: Record<string, ColumnType>): ContractParse {
  const table = parseTable(input)
  const required = Object.keys(contract)
  const missing = required.filter((c) => !table.headers.includes(c))
  if (missing.length) {
    const message = missingColumnsMessage(missing, table.headers)
    throw new CsvError(422, `${message}.`, [{ path: 'file', line: 1, message }])
  }

  const index = new Map(table.headers.map((h, i) => [h, i]))
  const issues = [...table.issues]
  const rows: Row[] = []
  for (const { line, cells } of table.records) {
    const row: Row = {}
    let rowOk = true
    for (const column of required) {
      const raw = cells[index.get(column)!] ?? ''
      if (contract[column] === 'integer_inr' || contract[column] === 'integer' || contract[column] === 'date') {
        const check = contract[column] === 'integer_inr' ? checkAmount(raw) : contract[column] === 'integer' ? checkWholeNumber(raw) : checkDate(raw)
        if (check.ok) row[column] = check.value
        else {
          rowOk = false
          issues.push({ path: 'file', line, column, message: `Line ${line}, ${column}: ${check.problem}` })
        }
      } else {
        const value = raw.trim()
        if (value.length > 10_000) {
          rowOk = false
          issues.push({ path: 'file', line, column, message: `Line ${line}, ${column}: the value is too long` })
        } else row[column] = value
      }
    }
    if (rowOk) rows.push(row)
  }

  if (issues.length) {
    issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
    const { message, issues: shown } = issueSummary('The file', issues)
    throw new CsvError(422, message, shown)
  }

  return { rows, headers: table.headers, ignoredColumns: table.headers.filter((h) => !Object.hasOwn(contract, h)) }
}

export type InferredColumn = {
  name: string
  type: ColumnType
  samples: string[]
  blanks: number
  /** Distinct non-blank values (capped); stays in the browser, never sent anywhere. */
  values: string[]
}

const DISTINCT_CAP = 200

/** Names that usually hold counts or quantities rather than rupees. */
const COUNT_LIKE = /(^|[_\s-])(qty|quantity|units?|count|number|num|no|pieces|pcs|items|seats|headcount|age|year|rank|days?|hours?)($|[_\s-])/i

/**
 * Suggests a type per column from a sample file (runs in the browser; the file
 * is not uploaded). A column is numeric if every non-blank value passes the
 * whole-number rule: a whole number when its name looks like a count or
 * quantity, otherwise an amount in rupees. It is a date if every non-blank
 * value reads as one. The author can change any of them.
 */
export function inferColumns(input: CsvInput): { columns: InferredColumn[]; rowCount: number; issues: ApiIssue[] } {
  const table = parseTable(input)
  const columns = table.headers.map((name, i) => {
    const values = table.records.map((r) => (r.cells[i] ?? '').trim())
    const nonBlank = values.filter((v) => v !== '')
    const numeric = nonBlank.length > 0 && nonBlank.every((v) => checkWholeNumber(v).ok)
    const isAmount = numeric && !COUNT_LIKE.test(name) && nonBlank.every((v) => checkAmount(v).ok)
    const isDate = !numeric && nonBlank.length > 0 && nonBlank.every((v) => checkDate(v).ok)
    const distinct = [...new Set(nonBlank)]
    return {
      name,
      type: (isAmount ? 'integer_inr' : numeric ? 'integer' : isDate ? 'date' : 'string') as ColumnType,
      samples: distinct.slice(0, 3),
      blanks: values.length - nonBlank.length,
      values: distinct.slice(0, DISTINCT_CAP),
    }
  })
  return { columns, rowCount: table.records.length, issues: table.issues }
}

/**
 * A text filter that can never match, found by comparing it with the values
 * actually present (e.g. "Paid" when the file only has "paid"). Returns a
 * plain-language hint and, for a casing mismatch, the value that would match.
 */
export function literalMismatch(
  column: string,
  literal: string,
  present: string[],
): { message: string; suggestion?: string } | null {
  if (!literal || present.length === 0 || present.includes(literal)) return null
  const suggestion = present.find((v) => v.toLowerCase() === literal.toLowerCase())
  if (suggestion) {
    return { message: `${column} is "${suggestion}" in the data, not "${literal}", and text matching is case-sensitive.`, suggestion }
  }
  const shown = present.slice(0, 6).map((v) => `"${v}"`).join(', ')
  return { message: `No row has ${column} = "${literal}". The data has ${shown}${present.length > 6 ? ', …' : ''}.` }
}

/**
 * Rewrites only the header row with the given renames (old name → new name),
 * keeping every data line. Runs in the browser before an upload, so a file
 * whose header says "Status" can be run by a recipe that needs "status".
 */
export function renameHeaders(input: CsvInput, renames: Record<string, string>): string {
  const rows = Papa.parse<string[]>(decode(input), { header: false, delimiter: ',', skipEmptyLines: false }).data
  const headerIndex = rows.findIndex((cells) => !isBlank(cells))
  if (headerIndex === -1) return decode(input)
  rows[headerIndex] = rows[headerIndex]!.map((h) => renames[h.trim()] ?? h)
  return Papa.unparse(rows, { newline: '\n' })
}

const formulaSafe = (cell: string) => (/^[=+\-@]/.test(cell) ? `'${cell}` : cell)

/** Tab-separated text for the clipboard: pastes into a spreadsheet as cells. Tabs and newlines inside a cell become spaces. */
export function toTsv(columns: string[], rows: Row[]): string {
  const cell = (value: string | number | undefined) => formulaSafe(String(value ?? '').replace(/[\t\r\n]+/g, ' '))
  return [columns.map(cell).join('\t'), ...rows.map((row) => columns.map((c) => cell(row[c])).join('\t'))].join('\n')
}

/** Serializes a result table. Cells that start like a formula are prefixed with ' so spreadsheets don't run them. */
export function toCsv(columns: string[], rows: Row[]): string {
  const csv = Papa.unparse(
    { fields: columns, data: rows.map((row) => columns.map((c) => row[c] ?? '')) },
    { escapeFormulae: true, newline: '\r\n' },
  )
  // Papa ends a header-only file with a newline; keep the shape consistent.
  return csv.replace(/\r\n$/, '')
}
