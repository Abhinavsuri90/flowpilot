import { describe, expect, it } from 'vitest'
import { CsvError, checkAmount, inferColumns, parseForContract, parseTable, renameHeaders, toCsv, toTsv } from '../src/lib/csv'

const bytes = (text: string) => new TextEncoder().encode(text)
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'
import { fixture } from './helpers/fixtures'

const CONTRACT = ORIGINAL.input.columns

function csvError(fn: () => unknown): CsvError {
  try {
    fn()
  } catch (err) {
    if (err instanceof CsvError) return err
    throw err
  }
  throw new Error('expected a CsvError')
}

const HEADER = 'order_id,region,sales_rep,status,amount'
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `O-${i},North,Asha,paid,${i}`).join('\n')

describe('csv: parsing against a recipe contract', () => {
  it('parses the demo file, drops extra columns and reports them as ignored', () => {
    const parsed = parseForContract(fixture('sales_A.csv') + '\n\n', CONTRACT)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.rows[0]).toEqual({ status: 'paid', region: 'North', sales_rep: 'Asha', amount: 60000 })
    expect(parsed.ignoredColumns).toEqual(['order_id'])
  })

  it('rejects a file without a required column', () => {
    const err = csvError(() => parseForContract(fixture('invalid/missing_amount.csv'), CONTRACT))
    expect(err.status).toBe(422)
    expect(err.code).toBe('INVALID_FILE')
    expect(err.issues[0]!.message).toBe('Missing required column: amount')
  })

  it('reports five kinds of bad amount with their line numbers', () => {
    const err = csvError(() => parseForContract(fixture('invalid/bad_amounts.csv'), CONTRACT))
    expect(err.status).toBe(422)
    expect(err.issues.map((i) => [i.line, i.column])).toEqual([
      [2, 'amount'],
      [3, 'amount'],
      [4, 'amount'],
      [5, 'amount'],
      [6, 'amount'],
    ])
    const messages = err.issues.map((i) => i.message)
    expect(messages[0]).toBe('Line 2, amount: "12.5" has decimals; use whole rupees (nothing is rounded)')
    expect(messages[1]).toBe('Line 3, amount: "-5" is negative; amounts must be zero or more')
    expect(messages[2]).toBe('Line 4, amount: "abc" is not a number')
    expect(messages[3]).toMatch(/^Line 5, amount: is blank; .*not treated as zero/)
    expect(messages[4]).toBe('Line 6, amount: "60,000" contains separators; write it as 60000')
    expect(err.message).toBe('The file has 5 problems.')
  })

  it('rejects duplicate headers, naming both columns', () => {
    const err = csvError(() => parseForContract(fixture('invalid/duplicate_headers.csv'), CONTRACT))
    expect(err.status).toBe(422)
    expect(err.issues[0]!.message).toBe('Duplicate header "amount" (columns 5 and 6)')
  })

  it('strips a UTF-8 BOM and trims headers and text cells', () => {
    const text = '﻿ order_id , region ,sales_rep, status ,amount \nO-1,  North ,Asha, paid , 500 \n'
    const parsed = parseForContract(text, CONTRACT)
    expect(parsed.headers).toEqual(['order_id', 'region', 'sales_rep', 'status', 'amount'])
    expect(parsed.rows).toEqual([{ status: 'paid', region: 'North', sales_rep: 'Asha', amount: 500 }])
  })

  it('reports rows with the wrong number of fields', () => {
    const err = csvError(() => parseForContract(`${HEADER}\nO-1,North,Asha,paid,5\nO-2,North,paid,5\n`, CONTRACT))
    expect(err.issues[0]).toMatchObject({ line: 3, message: 'Line 3 has 4 fields; expected 5' })
  })

  it('rejects files over 1 MiB with 413', () => {
    const big = `${HEADER}\n` + 'x'.repeat(1024 * 1024)
    const err = csvError(() => parseForContract(big, CONTRACT))
    expect(err.status).toBe(413)
    expect(err.code).toBe('FILE_TOO_LARGE')
  })

  it('accepts 5,000 data rows and rejects 5,001', () => {
    expect(parseForContract(`${HEADER}\n${rowsOf(5000)}`, CONTRACT).rows).toHaveLength(5000)
    const err = csvError(() => parseForContract(`${HEADER}\n${rowsOf(5001)}`, CONTRACT))
    expect(err.status).toBe(422)
    expect(err.message).toBe('The file has 5,001 data rows; the limit is 5,000.')
  })

  it('rejects more than 50 columns', () => {
    const header = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',')
    const err = csvError(() => parseTable(`${header}\n${Array(51).fill('1').join(',')}`))
    expect(err.status).toBe(422)
    expect(err.message).toBe('The file has 51 columns; the limit is 50.')
  })

  it('caps each amount at ₹1,00,00,000 per row', () => {
    expect(checkAmount('10000000')).toEqual({ ok: true, value: 10000000 })
    expect(checkAmount('10000001')).toEqual({ ok: false, problem: '10000001 is over the ₹1,00,00,000 limit per row' })
    expect(checkAmount('0007')).toEqual({ ok: true, value: 7 })
  })

  it('infers text and amount columns from a sample file', () => {
    const { columns, rowCount } = inferColumns(fixture('sales_A.csv'))
    expect(rowCount).toBe(6)
    expect(columns.map((c) => [c.name, c.type])).toEqual([
      ['order_id', 'string'],
      ['region', 'string'],
      ['sales_rep', 'string'],
      ['status', 'string'],
      ['amount', 'integer_inr'],
    ])
    expect(columns.find((c) => c.name === 'status')!.samples).toEqual(['paid', 'refunded', 'cancelled'])
  })

  it('escapes formula-like cells on export', () => {
    const parsed = parseForContract(fixture('invalid/formula_cell.csv'), CONTRACT)
    const csv = toCsv(['region', 'amount'], parsed.rows)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('region,amount')
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://example.com"")",60000`)
    expect(lines[2]).toBe(`"'@SUM(A1)",50000`)
    expect(lines[3]).toBe('South,40000')
    // Escaped cells are prefixed with ' and quoted; ordinary cells are untouched.
    expect(toCsv(['v'], [{ v: '+1' }, { v: '-2' }, { v: 'plain' }]).split('\r\n')).toEqual(['v', `"'+1"`, `"'-2"`, 'plain'])
  })
})

describe('csv: files as spreadsheets really save them', () => {
  it('reads UTF-8 bytes, with or without a BOM, like text', () => {
    const text = `${HEADER}\nO-1,Montréal,Asha,paid,100\n`
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(text)])
    expect(parseForContract(bytes(text), CONTRACT).rows[0]!.region).toBe('Montréal')
    expect(parseForContract(withBom, CONTRACT).rows[0]!.region).toBe('Montréal')
  })

  it("rejects Windows-1252 (Excel's plain CSV) instead of turning letters into �", () => {
    // "Montréal" with é as the single byte 0xE9, as Windows Excel writes it.
    const latin1 = new Uint8Array([...bytes(`${HEADER}\nO-1,Montr`), 0xe9, ...bytes('al,Asha,paid,100\n')])
    const err = csvError(() => parseForContract(latin1, CONTRACT))
    expect(err.status).toBe(422)
    expect(err.message).toMatch(/isn't saved as UTF-8/)
    expect(err.message).toMatch(/CSV UTF-8/)
    expect(err.issues[0]).toMatchObject({ line: 2 })
    expect(err.issues[0]!.message).toContain('O-1,Montr')
    // The editor's sample reader gets the same answer.
    expect(() => inferColumns(latin1)).toThrow(/UTF-8/)
  })

  it('rejects UTF-16 ("Unicode Text") with a way out', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...`${HEADER}\n`].flatMap((c) => [c.charCodeAt(0), 0])])
    expect(csvError(() => parseTable(utf16)).message).toMatch(/UTF-16.*CSV UTF-8/)
  })

  it('names semicolon- and tab-separated files instead of listing every column as missing', () => {
    const semicolons = csvError(() => parseForContract(`${HEADER.replaceAll(',', ';')}\nO-1;North;Asha;paid;100\n`, CONTRACT))
    expect(semicolons.message).toMatch(/separates values with semicolons/)
    const tabs = csvError(() => parseForContract(`${HEADER.replaceAll(',', '\t')}\nO-1\tNorth\tAsha\tpaid\t100\n`, CONTRACT))
    expect(tabs.message).toMatch(/separates values with tabs/)
  })

  it('explains an empty last header (a trailing comma on every line), still rejecting it', () => {
    const err = csvError(() => parseTable(`${HEADER},\nO-1,North,Asha,paid,100,\n`))
    expect(err.issues[0]!.message).toMatch(/^Column 6 has an empty header \(usually an extra comma/)
    // An empty header in the middle keeps the plain message.
    expect(csvError(() => parseTable('a,,b\n1,2,3\n')).issues[0]!.message).toBe('Column 2 has an empty header')
  })

  it('points at near-miss headers when a required column is missing', () => {
    const err = csvError(() => parseForContract('order_id,Region,sales_rep,Status,amount\nO-1,North,Asha,paid,1\n', CONTRACT))
    expect(err.issues[0]!.message).toBe(
      'Missing required columns: status (the file has "Status"), region (the file has "Region"). Column names must match exactly, including capitals',
    )
    // Headers are still matched exactly: no silent renaming.
    expect(csvError(() => parseForContract('Sales Rep,status,region,amount\nA,paid,North,1\n', CONTRACT)).issues[0]!.message).toMatch(
      /^Missing required column: sales_rep \(the file has "Sales Rep"\)/,
    )
  })
})

describe('csv: browser-side helpers', () => {
  it('renames only the header row, keeping every data line and its quoting', () => {
    const renamed = renameHeaders(bytes('\nStatus,Region,amount\npaid,"East, HQ",100\n\nrefunded,West,5\n'), { Status: 'status' })
    expect(renamed.split('\n').slice(0, 2)).toEqual(['', 'status,Region,amount'])
    expect(parseForContract(renamed, { status: 'string', amount: 'integer_inr' }).rows).toEqual([
      { status: 'paid', amount: 100 },
      { status: 'refunded', amount: 5 },
    ])
    // Unknown names are left alone; the file is otherwise untouched.
    expect(renameHeaders('a,b\n1,2', { zzz: 'q' })).toBe('a,b\n1,2')
  })

  it('copies a result as tab-separated text that pastes into a spreadsheet, formula-safe', () => {
    const text = toTsv(['region', 'total'], [{ region: 'North\tEast', total: 5 }, { region: '=HYPERLINK("x")', total: 0 }])
    expect(text).toBe("region\ttotal\nNorth East\t5\n'=HYPERLINK(\"x\")\t0")
  })
})
