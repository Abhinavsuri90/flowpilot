import Papa from 'papaparse'
import type { ApiIssue } from './types'
import { formatCount, formatINR } from './workflow/describe'
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

function decode(input: CsvInput): string {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
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
  let headerIndex = rows.findIndex((cells) => !isBlank(cells))
  if (headerIndex === -1) throw new CsvError(422, 'The file is empty.', [{ path: 'file', message: 'The file has no header row' }])

  const headers = rows[headerIndex]!.map((h) => h.trim())
  if (headers.length > LIMITS.columns) {
    throw new CsvError(422, `The file has ${headers.length} columns; the limit is ${LIMITS.columns}.`, [
      { path: 'file', line: headerIndex + 1, message: `The file has ${headers.length} columns; the limit is ${LIMITS.columns}` },
    ])
  }

  const headerIssues: ApiIssue[] = []
  const firstSeen = new Map<string, number>()
  headers.forEach((h, i) => {
    if (h === '') {
      headerIssues.push({ path: 'file', line: headerIndex + 1, message: `Column ${i + 1} has an empty header` })
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
    const message = `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
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
      if (contract[column] === 'integer_inr') {
        const check = checkAmount(raw)
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
}

/**
 * Suggests a type per column from a sample file (runs in the browser; the file
 * is not uploaded). A column is an amount if every non-blank value passes the
 * whole-rupee rule.
 */
export function inferColumns(input: CsvInput): { columns: InferredColumn[]; rowCount: number; issues: ApiIssue[] } {
  const table = parseTable(input)
  const columns = table.headers.map((name, i) => {
    const values = table.records.map((r) => (r.cells[i] ?? '').trim())
    const nonBlank = values.filter((v) => v !== '')
    const isAmount = nonBlank.length > 0 && nonBlank.every((v) => checkAmount(v).ok)
    return {
      name,
      type: (isAmount ? 'integer_inr' : 'string') as ColumnType,
      samples: [...new Set(nonBlank)].slice(0, 3),
      blanks: values.length - nonBlank.length,
    }
  })
  return { columns, rowCount: table.records.length, issues: table.issues }
}

/** Serializes a result table. Cells that start like a formula are prefixed with ' so spreadsheets don't run them. */
export function toCsv(columns: string[], rows: Row[]): string {
  return Papa.unparse(
    { fields: columns, data: rows.map((row) => columns.map((c) => row[c] ?? '')) },
    { escapeFormulae: true, newline: '\r\n' },
  )
}
