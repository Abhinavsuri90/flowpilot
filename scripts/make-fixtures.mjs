// Builds the spreadsheet fixtures for the browser tests from the CSV sample, so a
// real .xlsx goes through the same path as a person's file. Run: node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'

const rows = Papa.parse(readFileSync('fixtures/sales_A.csv', 'utf8'), { skipEmptyLines: true }).data
// Numbers as numbers, the way Excel stores what people type.
const typed = rows.map((row, i) => (i === 0 ? row : row.map((v) => (/^\d+$/.test(v) ? Number(v) : v))))
const write = (book, name) => writeFileSync(`fixtures/${name}`, XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }))

// One sheet of orders.
const one = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(one, XLSX.utils.aoa_to_sheet(typed), 'Orders')
write(one, 'sales_A.xlsx')

// A cover sheet first, the data second: the person has to pick the right sheet.
const two = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  two,
  XLSX.utils.aoa_to_sheet([['Sales export'], ['Generated for the FlowPilot browser tests'], [], ['Sheet', 'Contents'], ['Orders', 'One row per order']]),
  'Read me',
)
XLSX.utils.book_append_sheet(two, XLSX.utils.aoa_to_sheet(typed), 'Orders')
write(two, 'sales_two_sheets.xlsx')
console.log('wrote fixtures/sales_A.xlsx and fixtures/sales_two_sheets.xlsx')
