import Papa from 'papaparse'
import type { CellObject, WorkSheet } from 'xlsx'
import { formatBytes, formatCount } from './format'
import { isNumericType, LIMITS, type Column, type Row } from './workflow/schema'

/**
 * Spreadsheet files (Excel, OpenDocument) are read in the browser and turned
 * into CSV there: the server keeps one input format and never opens an archive,
 * and the workbook itself is never uploaded. SheetJS is imported only when a
 * workbook is picked, so the rest of the app doesn't carry it.
 */

export const WORKBOOK_EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'] as const
/** A small compressed workbook can unpack to far more than the CSV limit; nothing bigger is opened at all. */
export const WORKBOOK_BYTES = 4 * 1024 * 1024
/** For file inputs: CSV plus the workbook formats. */
export const FILE_ACCEPT = ['.csv', 'text/csv', ...WORKBOOK_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

/** Rows read from a sheet before giving up: enough to know it's over the limit, never unbounded. */
const READ_ROWS = LIMITS.rows * 2 + 2

export function fileKind(name: string): 'csv' | 'workbook' | 'other' {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') return 'csv'
  return (WORKBOOK_EXTENSIONS as readonly string[]).includes(ext) ? 'workbook' : 'other'
}

export class WorkbookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkbookError'
  }
}

export type SheetInfo = {
  name: string
  /** Rows under the header, blank rows skipped. */
  rows: number
  columns: number
  /** The sheet went past the read limit, so `rows` is a lower bound. */
  truncated: boolean
}

export type Workbook = {
  sheets: SheetInfo[]
  /** The first sheet holding anything, or null when the whole workbook is empty. */
  defaultSheet: string | null
  /** The sheet as CSV text; throws WorkbookError when it can't be run. */
  csvOf(sheet: string): string
}

const sheetjs = () => import('xlsx')
type Utils = Pick<Awaited<ReturnType<typeof sheetjs>>['utils'], 'decode_range' | 'encode_cell'>

export async function openWorkbook(bytes: Uint8Array): Promise<Workbook> {
  if (bytes.byteLength > WORKBOOK_BYTES) {
    throw new WorkbookError(`This workbook is ${formatBytes(bytes.byteLength)}; the limit is 4 MB. Save just the sheet you need, or save it as CSV.`)
  }
  // Every supported format is a zip (xlsx, xlsm, xlsb, ods) or a compound file (xls).
  // Anything else, e.g. CSV text renamed .xlsx, is refused here rather than read as text.
  if (!startsWith(bytes, ZIP_MAGIC) && !startsWith(bytes, CFB_MAGIC)) throw new WorkbookError(NOT_A_SPREADSHEET)
  const XLSX = await sheetjs()
  let book: ReturnType<typeof XLSX.read>
  try {
    book = XLSX.read(bytes, { type: 'array', cellDates: true, sheetRows: READ_ROWS })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (/password/i.test(reason)) {
      throw new WorkbookError('This workbook is password-protected. Remove the password (in Excel: File → Info → Protect Workbook) and try again.')
    }
    throw new WorkbookError(NOT_A_SPREADSHEET)
  }

  const tables = new Map(book.SheetNames.map((name) => [name, tableOf(XLSX.utils, book.Sheets[name]!)]))
  const sheets: SheetInfo[] = [...tables].map(([name, t]) => ({
    name,
    rows: Math.max(0, t.rows.length - 1),
    columns: t.width,
    truncated: t.truncated,
  }))
  return {
    sheets,
    defaultSheet: sheets.find((s) => s.columns > 0)?.name ?? null,
    csvOf(name) {
      const table = tables.get(name)
      if (!table) throw new WorkbookError(`There is no sheet called “${name}”.`)
      if (table.rows.length === 0) throw new WorkbookError(`Sheet “${name}” is empty.`)
      const dataRows = table.rows.length - 1
      if (table.truncated) {
        throw new WorkbookError(`Sheet “${name}” has over ${formatCount(LIMITS.rows * 2)} rows; the limit is ${formatCount(LIMITS.rows)}.`)
      }
      if (dataRows > LIMITS.rows) {
        throw new WorkbookError(`Sheet “${name}” has ${formatCount(dataRows)} rows; the limit is ${formatCount(LIMITS.rows)}.`)
      }
      const csv = Papa.unparse(table.rows, { newline: '\n' })
      const size = new TextEncoder().encode(csv).byteLength
      if (size > LIMITS.fileBytes) throw new WorkbookError(`Sheet “${name}” is ${formatBytes(size)} as CSV; the limit is 1 MiB.`)
      return csv
    },
  }
}

const NOT_A_SPREADSHEET = 'This file could not be read as a spreadsheet. Save it as .xlsx or CSV and try again.'
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b)

type Table = { rows: string[][]; width: number; truncated: boolean }

function tableOf(utils: Utils, ws: WorkSheet): Table {
  const ref = ws['!ref']
  if (!ref) return { rows: [], width: 0, truncated: false }
  const range = utils.decode_range(ref)
  // When the read stopped at the row limit, SheetJS keeps the full extent here.
  const fullRef = (ws as { '!fullref'?: string })['!fullref']
  const full = fullRef ? utils.decode_range(fullRef) : range
  const rows: string[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) cells.push(cellText(ws[utils.encode_cell({ r, c })] as CellObject | undefined))
    if (cells.some((v) => v !== '')) rows.push(cells)
  }
  // Formatting often extends a sheet's used range past the data: drop columns that are empty everywhere.
  let width = 0
  for (const cells of rows) {
    for (let i = cells.length - 1; i >= width; i--) {
      if (cells[i] !== '') {
        width = i + 1
        break
      }
    }
  }
  return { rows: rows.map((cells) => cells.slice(0, width)), width, truncated: full.e.r > range.e.r }
}

/** The cell as the CSV rules expect it: raw numbers (no thousands separators), ISO dates, TRUE/FALSE. */
function cellText(cell: CellObject | undefined): string {
  if (!cell) return ''
  switch (cell.t) {
    case 's':
      return cell.v == null ? '' : String(cell.v)
    case 'n':
      return numberText(cell.v as number)
    case 'd':
      return dateText(cell.v as Date)
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'e':
      return cell.w ?? '#ERROR'
    default:
      return cell.w ?? (cell.v == null ? '' : String(cell.v))
  }
}

function numberText(v: number): string {
  if (!Number.isFinite(v)) return ''
  if (Number.isInteger(v)) return String(v)
  // 15 significant digits, the precision Excel shows: 0.1 + 0.2 reads "0.3", not "0.30000000000000004".
  return String(Number(v.toPrecision(15)))
}

/**
 * SheetJS hands a cell's date back as a Date whose UTC fields hold the sheet's
 * own date and time (a workbook has no time zone), so those are the ones to read.
 */
function dateText(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const hasTime = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()
  return hasTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : day
}

// ----- Results → Excel ---------------------------------------------------------------------------

export type ResultExport = {
  columns: Column[]
  rows: Row[]
  /** Where the numbers came from, for the second sheet: [label, value] lines. */
  about: Array<[string, string]>
}

/** Indian grouping (12,34,56,789) as an Excel number format. */
const INR_FORMAT = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0'
const COUNT_FORMAT = '#,##0'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Results as a workbook: numbers stay numbers (so Excel can total them),
 * amounts get Indian grouping, text is never a formula, and a second sheet
 * records which recipe, version, file and parameters produced the numbers.
 */
export async function resultWorkbook({ columns, rows, about }: ResultExport): Promise<Blob> {
  const XLSX = await sheetjs()
  const header = columns.map((c) => c.name)
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows.map((row) => columns.map((c) => row[c.name] ?? ''))])
  columns.forEach((column, c) => {
    if (!isNumericType(column.type)) return
    const format = column.type === 'integer_inr' ? INR_FORMAT : COUNT_FORMAT
    for (let r = 1; r <= rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined
      if (cell?.t === 'n') cell.z = format
    }
  })
  ws['!cols'] = columns.map((column) => ({
    wch: Math.min(60, Math.max(column.name.length, ...rows.slice(0, 500).map((row) => String(row[column.name] ?? '').length)) + 2),
  }))
  if (rows.length > 0) ws['!autofilter'] = { ref: ws['!ref']! }

  const aboutSheet = XLSX.utils.aoa_to_sheet(about)
  aboutSheet['!cols'] = [{ wch: 14 }, { wch: 90 }]

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, 'Results')
  XLSX.utils.book_append_sheet(book, aboutSheet, 'About this run')
  const out = XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  return new Blob([out], { type: XLSX_TYPE })
}

/** "regional-revenue-exceptions-v2-2026-09-27.xlsx" */
export function exportFileName(title: string, version: number, at: string | Date): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'result'
  return `${slug}-v${version}-${new Date(at).toISOString().slice(0, 10)}.xlsx`
}

/** Offers a blob as a download (browser only). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
