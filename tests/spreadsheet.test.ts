import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { exportFileName, fileKind, openWorkbook, resultWorkbook, WORKBOOK_BYTES, WorkbookError } from '../src/lib/spreadsheet'
import { parseForContract } from '../src/lib/csv'
import { LIMITS, type ColumnType } from '../src/lib/workflow/schema'
import { fixture } from './helpers/fixtures'

// Workbooks are converted to CSV in the browser; these tests run that code in Node
// on files written by SheetJS itself (xlsx, xls, xlsb, ods).

function workbook(sheets: Record<string, unknown[][]>, bookType: XLSX.BookType = 'xlsx'): Uint8Array {
  const book = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name)
  }
  return new Uint8Array(XLSX.write(book, { bookType, type: 'array' }) as ArrayBuffer)
}

describe('workbook → CSV', () => {
  it('converts the first sheet with data: raw numbers, ISO dates, booleans, no blank rows or empty trailing columns', async () => {
    const book = await openWorkbook(
      workbook({
        Cover: [[]],
        Orders: [
          ['order_id', 'region', 'amount', 'ordered_on', 'paid', 'note', ''],
          [1001, 'North', 48000, new Date(2026, 0, 15), true, '', ''],
          ['', '', '', '', '', '', ''],
          [1002, 'South', 12500.5, new Date(2026, 1, 3, 9, 30), false, '=SUM(A1)', ''],
          [1003, 'East, "HQ"', 0.1 + 0.2, '', '', 'two words', ''],
        ],
      }),
    )
    expect(book.defaultSheet).toBe('Orders')
    expect(book.sheets).toEqual([
      { name: 'Cover', rows: 0, columns: 0, truncated: false },
      { name: 'Orders', rows: 3, columns: 6, truncated: false },
    ])
    expect(book.csvOf('Orders')).toBe(
      [
        'order_id,region,amount,ordered_on,paid,note',
        '1001,North,48000,2026-01-15,TRUE,',
        '1002,South,12500.5,2026-02-03 09:30:00,FALSE,=SUM(A1)',
        '1003,"East, ""HQ""",0.3,,,two words',
      ].join('\n'),
    )
  })

  it('an Excel version of the sample file runs exactly like the CSV', async () => {
    const csv = fixture('sales_A.csv')
    const rows = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data
    const typed = rows.map((r, i) => (i === 0 ? r : r.map((v) => (/^\d+$/.test(v) ? Number(v) : v))))
    const book = await openWorkbook(workbook({ Orders: typed }))
    const contract: Record<string, ColumnType> = { region: 'string', status: 'string', amount: 'integer_inr' }
    expect(parseForContract(book.csvOf('Orders'), contract).rows).toEqual(parseForContract(csv, contract).rows)
  })

  it('reads .xls, .xlsb and .ods files the same way', async () => {
    for (const type of ['biff8', 'xlsb', 'ods'] as const) {
      const book = await openWorkbook(workbook({ Sheet1: [['name', 'qty'], ['Pens', 12], ['Ink', 3]] }, type))
      expect(book.csvOf('Sheet1'), type).toBe('name,qty\nPens,12\nInk,3')
    }
  })

  it('names the sheet in every problem: empty, missing, over the row limit', async () => {
    const big = [['n'], ...Array.from({ length: LIMITS.rows + 1 }, (_, i) => [i])]
    const huge = [['n'], ...Array.from({ length: LIMITS.rows * 2 + 5 }, (_, i) => [i])]
    const book = await openWorkbook(workbook({ Empty: [[]], Big: big, Huge: huge }))
    expect(book.defaultSheet).toBe('Big')
    expect(() => book.csvOf('Empty')).toThrow('Sheet “Empty” is empty.')
    expect(() => book.csvOf('Nope')).toThrow(WorkbookError)
    expect(() => book.csvOf('Big')).toThrow('Sheet “Big” has 5,001 rows; the limit is 5,000.')
    expect(() => book.csvOf('Huge')).toThrow('Sheet “Huge” has over 10,000 rows; the limit is 5,000.')
    expect(book.sheets.find((s) => s.name === 'Huge')?.truncated).toBe(true)
  })

  it('refuses oversized workbooks before opening them, and text files that only pretend to be workbooks', async () => {
    await expect(openWorkbook(new Uint8Array(WORKBOOK_BYTES + 1))).rejects.toThrow('the limit is 4 MB')
    await expect(openWorkbook(new TextEncoder().encode('region,amount\nNorth,5\n'))).rejects.toThrow('could not be read as a spreadsheet')
  })

  it('tells CSV, workbooks and other files apart by name', () => {
    expect(['orders.csv', 'Orders.XLSX', 'old.xls', 'book.xlsb', 'sheet.ods', 'notes.txt', 'archive.zip'].map(fileKind)).toEqual([
      'csv',
      'workbook',
      'workbook',
      'workbook',
      'workbook',
      'other',
      'other',
    ])
  })
})

describe('results → Excel', () => {
  it('writes real numbers with Indian grouping, never a formula, plus an about sheet', async () => {
    const blob = await resultWorkbook({
      columns: [
        { name: 'region', type: 'string' },
        { name: 'total', type: 'integer_inr' },
        { name: 'orders', type: 'integer' },
      ],
      rows: [
        { region: 'North', total: 4800000, orders: 12 },
        { region: '=HYPERLINK("https://evil.example")', total: 0, orders: 0 },
      ],
      about: [
        ['Recipe', 'Regional revenue'],
        ['Version', 'v2'],
      ],
    })
    expect(blob.type).toContain('spreadsheetml')
    const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellNF: true })
    expect(book.SheetNames).toEqual(['Results', 'About this run'])
    const ws = book.Sheets.Results!
    expect(ws.B2).toMatchObject({ t: 'n', v: 4800000, w: '48,00,000' })
    expect(ws.B2!.z).toContain('##\\,##\\,##0')
    expect(ws.C2).toMatchObject({ t: 'n', v: 12 })
    expect(ws.A3).toMatchObject({ t: 's', v: '=HYPERLINK("https://evil.example")' })
    expect(ws.A3!.f).toBeUndefined()
    expect(ws['!autofilter']).toEqual({ ref: 'A1:C3' })
    expect(book.Sheets['About this run']!.A1).toMatchObject({ v: 'Recipe' })
    expect(book.Sheets['About this run']!.B2).toMatchObject({ v: 'v2' })
  })

  it('names the download after the recipe, version and day', () => {
    expect(exportFileName('Regional revenue: exceptions!', 2, '2026-09-27T10:00:00Z')).toBe('regional-revenue-exceptions-v2-2026-09-27.xlsx')
    expect(exportFileName('???', 1, new Date('2026-01-05T00:00:00Z'))).toBe('result-v1-2026-01-05.xlsx')
  })
})
