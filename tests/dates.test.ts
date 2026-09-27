import { beforeEach, describe, expect, it } from 'vitest'
import { checkDate, datePart, dayNumber, describeRelative, formatDate, fromDayNumber, isoWeek, relativeDate, todayIn, todayIso, usesRelativeDates } from '../src/lib/dates'
import { execute } from '../src/lib/workflow/execute'
import { resolveParameters, validateDefinition } from '../src/lib/workflow/validate'
import { describeParameters, describeRecipe, summarize } from '../src/lib/workflow/describe'
import { CsvError, inferColumns, parseForContract } from '../src/lib/csv'
import type { Row, Step, WorkflowDefinition } from '../src/lib/workflow/schema'
import { freshApp, signIn } from './helpers/app'

// Dates in the recipe language: a strict date column type, filters by fixed,
// adjustable or run-day-relative dates, and periods (month, quarter, year, week)
// to group by. Every date is "YYYY-MM-DD" text; the maths never touches a time zone.

const ORDERS = { order_id: 'string', ordered_on: 'date', region: 'string', status: 'string', amount: 'integer_inr' } as const

function recipe(steps: Step[], parameters: WorkflowDefinition['parameters'] = {}): WorkflowDefinition {
  return { schemaVersion: 1, input: { format: 'csv', columns: { ...ORDERS } }, parameters, steps, output: { format: 'table' } }
}

function valid(def: WorkflowDefinition): WorkflowDefinition {
  const result = validateDefinition(def)
  if (!result.ok) throw new Error(`invalid recipe: ${result.issues.map((i) => i.message).join('; ')}`)
  return result.definition
}

function issuesOf(def: unknown): string[] {
  const result = validateDefinition(def)
  return result.ok ? [] : result.issues.map((i) => i.message)
}

const CSV = `order_id,ordered_on,region,status,amount
O-1,2026-07-14,North,paid,60000
O-2,2026-08-02,South,paid,50000
O-3,2026-08-30,North,refunded,40000
O-4,2026-09-01,West,paid,70000
O-5,2026-09-26,North,paid,30000
O-6,2026-09-27,South,paid,20000
`

const PAID: Step = { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } }
const LAST_30_DAYS: Step = { id: 's2', type: 'filter', column: 'ordered_on', operator: 'gte', value: { relative: { unit: 'day', offset: -30, edge: 'start' } } }
const ids = (rows: Row[]) => rows.map((r) => r.order_id)
const rowsOf = (def: WorkflowDefinition) => parseForContract(CSV, def.input.columns).rows

describe('reading dates from files', () => {
  it('accepts ISO and named-month forms, and digits only when they can mean one date', () => {
    const read = (s: string) => {
      const r = checkDate(s)
      return r.ok ? r.value : r.problem
    }
    expect(read('2026-04-03')).toBe('2026-04-03')
    expect(read('2026-04-03T09:30:00Z')).toBe('2026-04-03')
    expect(read('2026-04-03 09:30')).toBe('2026-04-03')
    expect(read('2026/4/3')).toBe('2026-04-03')
    expect(read('3 Apr 2026')).toBe('2026-04-03')
    expect(read('03-Apr-2026')).toBe('2026-04-03')
    expect(read('3rd April 2026')).toBe('2026-04-03')
    expect(read('April 3, 2026')).toBe('2026-04-03')
    expect(read('Sept 3 2026')).toBe('2026-09-03')
    expect(read('15/04/2026')).toBe('2026-04-15') // only day-first is a real date
    expect(read('04/15/2026')).toBe('2026-04-15') // only month-first is
    expect(read('05.05.2026')).toBe('2026-05-05')
    expect(read('03/04/2026')).toBe(
      '"03/04/2026" could be 3 Apr 2026 or 4 Mar 2026; write dates as 2026-04-03, or upload the Excel file itself (its dates convert exactly)',
    )
    expect(read('03/04/26')).toContain('has a two-digit year')
    expect(read('2026-02-30')).toBe('"2026-02-30" is not a real date')
    expect(read('31/02/2026')).toBe('"31/02/2026" is not a real date')
    expect(read('yesterday')).toContain('is not a date')
    expect(read('1899-12-31')).toBe('"1899-12-31" is not a real date')
    expect(read('')).toBe('is blank; every row needs a date')
  })

  it('suggests the date type from a sample, and reports bad cells with their line', () => {
    const inferred = inferColumns(CSV).columns.map((c) => [c.name, c.type])
    expect(inferred).toEqual([
      ['order_id', 'string'],
      ['ordered_on', 'date'],
      ['region', 'string'],
      ['status', 'string'],
      ['amount', 'integer_inr'],
    ])
    expect(parseForContract(CSV, { ordered_on: 'date' }).rows[0]).toEqual({ ordered_on: '2026-07-14' })
    const dayFirst = CSV.replace('2026-08-30', '30/08/2026')
    expect(parseForContract(dayFirst, { ordered_on: 'date' }).rows.map((r) => r.ordered_on)).toContain('2026-08-30')
    const bad = CSV.replace('2026-09-26', '03/04/2026')
    expect(() => parseForContract(bad, { ordered_on: 'date' })).toThrow(CsvError)
    try {
      parseForContract(bad, { ordered_on: 'date' })
    } catch (err) {
      expect((err as CsvError).issues[0]!.message).toBe(
        'Line 6, ordered_on: "03/04/2026" could be 3 Apr 2026 or 4 Mar 2026; write dates as 2026-04-03, or upload the Excel file itself (its dates convert exactly)',
      )
    }
  })
})

describe('calendar maths', () => {
  it('day numbers round-trip across leap days and century rules', () => {
    for (const iso of ['1900-03-01', '1970-01-01', '2000-02-29', '2024-02-29', '2026-09-27', '2100-03-01', '2200-12-31']) {
      const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
      const back = fromDayNumber(dayNumber({ y, m, d }))
      expect(back, iso).toEqual({ y, m, d })
    }
    expect(dayNumber({ y: 1970, m: 1, d: 1 })).toBe(0)
    expect(dayNumber({ y: 2026, m: 9, d: 27 }) - dayNumber({ y: 2026, m: 1, d: 1 })).toBe(269)
  })

  it('relative dates: days, weeks from Monday, month ends, quarters and years', () => {
    const sunday = '2026-09-27'
    expect(relativeDate(sunday, { unit: 'day', offset: -30, edge: 'start' })).toBe('2026-08-28')
    expect(relativeDate(sunday, { unit: 'day', offset: 0, edge: 'end' })).toBe('2026-09-27')
    expect(relativeDate(sunday, { unit: 'week', offset: 0, edge: 'start' })).toBe('2026-09-21')
    expect(relativeDate(sunday, { unit: 'week', offset: 0, edge: 'end' })).toBe('2026-09-27')
    expect(relativeDate(sunday, { unit: 'week', offset: -1, edge: 'start' })).toBe('2026-09-14')
    expect(relativeDate(sunday, { unit: 'month', offset: 0, edge: 'start' })).toBe('2026-09-01')
    expect(relativeDate(sunday, { unit: 'month', offset: -1, edge: 'end' })).toBe('2026-08-31')
    expect(relativeDate('2026-03-31', { unit: 'month', offset: -1, edge: 'end' })).toBe('2026-02-28')
    expect(relativeDate('2028-03-15', { unit: 'month', offset: -1, edge: 'end' })).toBe('2028-02-29')
    expect(relativeDate('2026-01-15', { unit: 'month', offset: -1, edge: 'start' })).toBe('2025-12-01')
    expect(relativeDate('2026-11-15', { unit: 'month', offset: 2, edge: 'start' })).toBe('2027-01-01')
    expect(relativeDate(sunday, { unit: 'quarter', offset: 0, edge: 'start' })).toBe('2026-07-01')
    expect(relativeDate(sunday, { unit: 'quarter', offset: 0, edge: 'end' })).toBe('2026-09-30')
    expect(relativeDate(sunday, { unit: 'quarter', offset: -1, edge: 'end' })).toBe('2026-06-30')
    expect(relativeDate('2026-02-10', { unit: 'quarter', offset: -1, edge: 'start' })).toBe('2025-10-01')
    expect(relativeDate(sunday, { unit: 'year', offset: 0, edge: 'start' })).toBe('2026-01-01')
    expect(relativeDate(sunday, { unit: 'year', offset: -1, edge: 'end' })).toBe('2025-12-31')
  })

  it('periods: year, quarter, month and ISO week (a week belongs to the year of its Thursday)', () => {
    expect(datePart('2026-09-27', 'year')).toBe('2026')
    expect(datePart('2026-09-27', 'quarter')).toBe('2026-Q3')
    expect(datePart('2026-09-27', 'month')).toBe('2026-09')
    expect(datePart('2026-09-27', 'week')).toBe('2026-W39')
    expect(datePart('2026-01-01', 'week')).toBe('2026-W01') // a Thursday
    expect(datePart('2027-01-01', 'week')).toBe('2026-W53') // a Friday, still in 2026's last week
    expect(datePart('2024-12-30', 'week')).toBe('2025-W01') // a Monday, already in 2025's first week
    expect(isoWeek({ y: 2026, m: 9, d: 27 })).toEqual({ year: 2026, week: 39 })
  })

  it('describes relative dates in words, and dates for people', () => {
    expect(describeRelative({ unit: 'day', offset: 0, edge: 'start' })).toBe('today')
    expect(describeRelative({ unit: 'day', offset: -1, edge: 'start' })).toBe('yesterday')
    expect(describeRelative({ unit: 'day', offset: 1, edge: 'end' })).toBe('tomorrow')
    expect(describeRelative({ unit: 'day', offset: -30, edge: 'start' })).toBe('30 days ago')
    expect(describeRelative({ unit: 'month', offset: 0, edge: 'start' })).toBe('the start of this month')
    expect(describeRelative({ unit: 'quarter', offset: -1, edge: 'end' })).toBe('the end of last quarter')
    expect(describeRelative({ unit: 'year', offset: 1, edge: 'start' })).toBe('the start of next year')
    expect(describeRelative({ unit: 'month', offset: -2, edge: 'start' })).toBe('the start of the month 2 months ago')
    expect(formatDate('2026-09-01')).toBe('1 Sep 2026')
    expect(todayIso(new Date(Date.UTC(2026, 8, 27, 23, 30)), true)).toBe('2026-09-27')
  })
})

describe('recipes with dates', () => {
  it('filters by relative, fixed and adjustable dates, counting from the run day', () => {
    const last30 = valid(recipe([LAST_30_DAYS, PAID]))
    expect(ids(execute(last30, rowsOf(last30), {}, { asOf: '2026-09-27' }).rows)).toEqual(['O-4', 'O-5', 'O-6'])
    // From 16 Jul 2026 on: everything paid except O-1 (14 Jul).
    expect(ids(execute(last30, rowsOf(last30), {}, { asOf: '2026-08-15' }).rows)).toEqual(['O-2', 'O-4', 'O-5', 'O-6'])
    expect(usesRelativeDates(last30)).toBe(true)

    const thisMonth = valid(
      recipe([
        { id: 's1', type: 'filter', column: 'ordered_on', operator: 'gte', value: { relative: { unit: 'month', offset: 0, edge: 'start' } } },
        { id: 's2', type: 'filter', column: 'ordered_on', operator: 'lte', value: { relative: { unit: 'month', offset: 0, edge: 'end' } } },
      ]),
    )
    expect(ids(execute(thisMonth, rowsOf(thisMonth), {}, { asOf: '2026-08-15' }).rows)).toEqual(['O-2', 'O-3'])

    const after = valid(recipe([{ id: 's1', type: 'filter', column: 'ordered_on', operator: 'gt', value: { literal: '2026-09-01' } }]))
    expect(ids(execute(after, rowsOf(after), {}).rows)).toEqual(['O-5', 'O-6'])
    expect(usesRelativeDates(after)).toBe(false)

    const from = valid(
      recipe([{ id: 's1', type: 'filter', column: 'ordered_on', operator: 'gte', value: { parameter: 'from_date' } }], {
        from_date: { type: 'date', default: '2026-09-01' },
      }),
    )
    const defaults = resolveParameters(from, {})
    expect(defaults).toEqual({ ok: true, values: { from_date: '2026-09-01' } })
    expect(ids(execute(from, rowsOf(from), { from_date: '2026-09-01' }).rows)).toEqual(['O-4', 'O-5', 'O-6'])
    expect(ids(execute(from, rowsOf(from), { from_date: '2026-09-27' }).rows)).toEqual(['O-6'])
    expect(resolveParameters(from, { from_date: '2026-13-01' })).toEqual({
      ok: false,
      issues: [{ path: 'parameters.from_date', message: 'from_date must be a date like 2026-04-03' }],
    })
  })

  it('groups by month through a period column, with the earliest and latest date per group', () => {
    const def = valid(
      recipe([
        PAID,
        { id: 's2', type: 'date_part', column: 'ordered_on', part: 'month', as: 'month' },
        {
          id: 's3',
          type: 'aggregate',
          groupBy: ['month'],
          measures: [
            { op: 'sum', column: 'amount', as: 'revenue' },
            { op: 'count', as: 'orders' },
            { op: 'min', column: 'ordered_on', as: 'first_order' },
            { op: 'max', column: 'ordered_on', as: 'last_order' },
          ],
        },
      ]),
    )
    const result = execute(def, rowsOf(def), {})
    expect(result.columns).toEqual([
      { name: 'month', type: 'string' },
      { name: 'revenue', type: 'integer_inr' },
      { name: 'orders', type: 'integer' },
      { name: 'first_order', type: 'date' },
      { name: 'last_order', type: 'date' },
    ])
    expect(result.rows).toEqual([
      { month: '2026-07', revenue: 60000, orders: 1, first_order: '2026-07-14', last_order: '2026-07-14' },
      { month: '2026-08', revenue: 50000, orders: 1, first_order: '2026-08-02', last_order: '2026-08-02' },
      { month: '2026-09', revenue: 120000, orders: 3, first_order: '2026-09-01', last_order: '2026-09-27' },
    ])
    expect(result.stepLog.map((s) => [s.type, s.rowsOut])).toEqual([
      ['filter', 5],
      ['date_part', 5],
      ['aggregate', 3],
    ])
    expect(describeRecipe(def)[1]).toBe('Add month: the month of ordered_on')
    expect(describeRecipe(def)[2]).toBe('Group by month: total amount as revenue, number of rows as orders, smallest ordered_on as first_order, largest ordered_on as last_order')

    const byWeek = valid(recipe([{ id: 's1', type: 'date_part', column: 'ordered_on', part: 'week', as: 'week' }, { id: 's2', type: 'sort', by: [{ column: 'ordered_on', direction: 'desc' }] }]))
    const weekly = execute(byWeek, rowsOf(byWeek), {})
    expect(weekly.rows[0]).toMatchObject({ order_id: 'O-6', week: '2026-W39' })
    expect(describeRecipe(byWeek)[1]).toBe('Sort by ordered_on (newest first)')
  })

  it('shows the dates a relative value meant on the run day, in summaries, step text and parameters', () => {
    const def = valid(recipe([LAST_30_DAYS, PAID], { from_date: { type: 'date', default: '2026-09-01' } }))
    expect(summarize(def, {}, 3, '2026-09-27')).toBe('3 rows · ordered_on ≥ 30 days ago (28 Aug 2026) · status = "paid"')
    expect(summarize(def, {}, 3)).toBe('3 rows · ordered_on ≥ 30 days ago · status = "paid"')
    expect(describeRecipe(def, {}, '2026-09-27')[0]).toBe('Keep rows where ordered_on is on or after 30 days ago (28 Aug 2026)')
    expect(describeParameters(def, { from_date: '2026-09-01', as_of: '2026-09-27' })).toBe('from_date 1 Sep 2026, as of 27 Sep 2026')
  })

  it('explains every wrong use of a date', () => {
    const bad = (step: Step, parameters: WorkflowDefinition['parameters'] = {}) => issuesOf(recipe([step], parameters))
    expect(bad({ id: 's1', type: 'filter', column: 'ordered_on', operator: 'contains', value: { literal: '2026' } })).toContain(
      '"contains" works on text, but "ordered_on" is a date column',
    )
    expect(bad({ id: 's1', type: 'filter', column: 'region', operator: 'eq', value: { relative: { unit: 'day', offset: 0, edge: 'start' } } })).toContain(
      'A date relative to the run day only works on a date column, and "region" is a text column',
    )
    expect(bad({ id: 's1', type: 'filter', column: 'ordered_on', operator: 'gte', value: { literal: 'yesterday' } })).toContain(
      '"ordered_on" is a date column, so the value must be a date like 2026-04-03',
    )
    expect(bad({ id: 's1', type: 'filter', column: 'ordered_on', operator: 'gte', value: { parameter: 'threshold' } }, { threshold: { type: 'integer', default: 1, min: 0, max: 10 } })).toContain(
      'Parameter "threshold" is a number, but "ordered_on" is a date column',
    )
    expect(bad({ id: 's1', type: 'filter', column: 'amount', operator: 'gte', value: { parameter: 'from' } }, { from: { type: 'date', default: '2026-01-01' } })).toContain(
      'Parameter "from" is a date, but "amount" is an amount column',
    )
    expect(bad({ id: 's1', type: 'aggregate', groupBy: ['region'], measures: [{ op: 'sum', column: 'ordered_on', as: 'x' }] })).toContain(
      '"ordered_on" is a date column. Totals and averages need an amount or whole-number column; smallest and largest work on dates',
    )
    expect(bad({ id: 's1', type: 'date_part', column: 'region', part: 'month', as: 'm' })).toContain(
      '"region" is a text column. A period needs a date column (set the column\'s type to date if it holds dates)',
    )
    expect(bad({ id: 's1', type: 'date_part', column: 'ordered_on', part: 'month', as: 'region' })).toContain(
      'There is already a column called "region". Choose another name for the period',
    )
    expect(bad({ id: 's1', type: 'group_sum', groupBy: 'ordered_on', valueColumn: 'amount', as: 'total' })).toContain(
      '"ordered_on" is a date column. Add a period (month, quarter or year) from it first, then group by that',
    )
    expect(bad(PAID, { from: { type: 'date', default: '01/02/2026' } })).toContain('from: the default must be a date like 2026-04-03')
    expect(bad({ id: 's1', type: 'filter', column: 'ordered_on', operator: 'gte', value: { relative: { unit: 'fortnight', offset: 0, edge: 'start' } } } as unknown as Step)).toContain(
      'A relative date counts in day, week, month, quarter or year',
    )
  })

  describe('through the API', () => {
    beforeEach(async () => {
      await freshApp()
    })

    it('stores the as-of day beside the parameters, shows it in the summary, and rejects a bad one', async () => {
      const asha = await signIn('asha')
      const created = await asha.post('/api/workflows', { title: 'Paid in the last 30 days', definition: recipe([LAST_30_DAYS, PAID]) })
      expect(created.status).toBe(201)
      const versionId = created.body.version.id as string

      const run = await asha.run(versionId, CSV, {}, { asOf: '2026-09-27' })
      expect(run.status).toBe(201)
      expect(run.body.rowCount).toBe(3)
      expect(run.body.parameters).toEqual({ as_of: '2026-09-27' })
      expect(run.body.parametersText).toBe('as of 27 Sep 2026')
      expect(run.body.summary).toBe('3 rows · ordered_on ≥ 30 days ago (28 Aug 2026) · status = "paid"')

      const bad = await asha.run(versionId, CSV, {}, { asOf: 'tomorrow' })
      expect(bad.status).toBe(422)
      expect(bad.body.error.code).toBe('PARAMETERS_INVALID')

      // Without an as-of day the server uses today in the workspace's time zone (Sales keeps
      // India time), and a recipe without relative dates stores nothing extra.
      const today = await asha.run(versionId, CSV)
      expect(today.status).toBe(201)
      expect(today.body.parameters.as_of).toBe(todayIn('Asia/Kolkata'))
      const fixed = await asha.post('/api/workflows', { title: 'Paid after a date', definition: recipe([PAID]) })
      const plain = await asha.run(fixed.body.version.id, CSV)
      expect(plain.body.parameters).toEqual({})
    })
  })
})
