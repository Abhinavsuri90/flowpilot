import { beforeEach, describe, expect, it } from 'vitest'
import { execute, roundedAverage } from '../src/lib/workflow/execute'
import { describeRecipe, summarize } from '../src/lib/workflow/describe'
import { validateDefinition } from '../src/lib/workflow/validate'
import { CsvError, checkWholeNumber, inferColumns, parseForContract } from '../src/lib/csv'
import type { Row, Step, WorkflowDefinition } from '../src/lib/workflow/schema'
import { SEED_EXAMPLES, TOP_REPS_BY_REVENUE } from '../src/lib/workflow/examples'
import { freshApp, signIn } from './helpers/app'
import { fixture, runFixture } from './helpers/fixtures'

// Recipe language v2: summaries (count/sum/avg/min/max), sort, keep first N,
// choose columns, "contains" and "is one of" filters, and whole-number columns.

const SALES = { status: 'string', region: 'string', sales_rep: 'string', amount: 'integer_inr' } as const

function recipe(steps: Step[], parameters: WorkflowDefinition['parameters'] = {}, columns: WorkflowDefinition['input']['columns'] = SALES): WorkflowDefinition {
  return { schemaVersion: 1, input: { format: 'csv', columns: { ...columns } }, parameters, steps, output: { format: 'table' } }
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

const PAID: Step = { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } }
const values = (rows: Row[], ...columns: string[]) => rows.map((r) => columns.map((c) => r[c]))

describe('summaries', () => {
  it('count, total, average, smallest and largest per group, sorted by the group', () => {
    const def = valid(
      recipe([
        PAID,
        {
          id: 's2',
          type: 'aggregate',
          groupBy: ['sales_rep'],
          measures: [
            { op: 'count', as: 'orders' },
            { op: 'sum', column: 'amount', as: 'revenue' },
            { op: 'avg', column: 'amount', as: 'avg_deal' },
            { op: 'min', column: 'amount', as: 'smallest' },
            { op: 'max', column: 'amount', as: 'largest' },
          ],
        },
      ]),
    )
    const result = runFixture(def, 'sales_A.csv')
    expect(values(result.rows, 'sales_rep', 'orders', 'revenue', 'avg_deal', 'smallest', 'largest')).toEqual([
      ['Asha', 3, 180000, 60000, 50000, 70000],
      ['Vikram', 1, 40000, 40000, 40000, 40000],
    ])
    // A count is a whole number, the rest stay amounts.
    expect(result.columns.map((c) => c.type)).toEqual(['string', 'integer', 'integer_inr', 'integer_inr', 'integer_inr', 'integer_inr'])
  })

  it('groups by two columns, and with no group-by makes one summary row (none when there are no rows)', () => {
    const two = runFixture(
      valid(recipe([{ id: 's1', type: 'aggregate', groupBy: ['region', 'sales_rep'], measures: [{ op: 'count', as: 'orders' }, { op: 'sum', column: 'amount', as: 'total' }] }])),
      'sales_A.csv',
    )
    expect(values(two.rows, 'region', 'sales_rep', 'orders', 'total')).toEqual([
      ['North', 'Asha', 2, 110000],
      ['South', 'Vikram', 2, 130000],
      ['West', 'Asha', 1, 70000],
      ['West', 'Vikram', 1, 30000],
    ])
    const all = valid(recipe([{ id: 's1', type: 'aggregate', groupBy: [], measures: [{ op: 'count', as: 'orders' }, { op: 'avg', column: 'amount', as: 'average' }] }]))
    expect(runFixture(all, 'sales_A.csv').rows).toEqual([{ orders: 6, average: 56667 }]) // 3,40,000 / 6 = 56,666.67 → 56,667
    const none = valid(recipe([{ ...PAID, value: { literal: 'nobody' } }, { ...all.steps[0]!, id: 's2' }]))
    expect(runFixture(none, 'sales_A.csv').rows).toEqual([])
  })

  it('rounds averages to the nearest whole number, halves up, exactly', () => {
    expect([roundedAverage(3, 2), roundedAverage(5, 3), roundedAverage(4, 3), roundedAverage(0, 4)]).toEqual([2, 2, 1, 0])
    expect(roundedAverage(Number.MAX_SAFE_INTEGER, 3)).toBe(3002399751580330) // …330.33, exact even beyond 2^53 / 2
  })
})

describe('sort, keep first N and choose columns', () => {
  const topRegions = (n: { literal: number } | { parameter: string }) =>
    recipe(
      [
        PAID,
        { id: 's2', type: 'aggregate', groupBy: ['region'], measures: [{ op: 'sum', column: 'amount', as: 'revenue' }] },
        { id: 's3', type: 'sort', by: [{ column: 'revenue', direction: 'desc' }] },
        { id: 's4', type: 'limit', rows: n },
        { id: 's5', type: 'select', columns: [{ column: 'region', as: 'Region' }, { column: 'revenue', as: 'Paid revenue' }] },
      ],
      { top_n: { type: 'integer', default: 2, min: 1, max: 100 } },
    )

  it('gives the top N (fixed or adjustable), with friendly headers', () => {
    const fixed = runFixture(valid(topRegions({ literal: 2 })), 'sales_A.csv')
    expect(fixed.rows).toEqual([
      { Region: 'North', 'Paid revenue': 110000 },
      { Region: 'West', 'Paid revenue': 70000 },
    ])
    expect(fixed.columns).toEqual([
      { name: 'Region', type: 'string' },
      { name: 'Paid revenue', type: 'integer_inr' },
    ])
    const adjustable = valid(topRegions({ parameter: 'top_n' }))
    expect(runFixture(adjustable, 'sales_A.csv', { top_n: 3 }).rows).toHaveLength(3)
    expect(summarize(adjustable, { top_n: 3 }, 3)).toBe('3 rows · status = "paid" · grouped by region · sorted by revenue ↓ · first 3')
  })

  it('sorts by several keys, keeps ties in file order, and orders text by code point', () => {
    const def = valid(recipe([{ id: 's1', type: 'sort', by: [{ column: 'sales_rep', direction: 'asc' }, { column: 'amount', direction: 'desc' }] }]))
    const rows = execute(def, parseForContract(fixture('sales_A.csv'), def.input.columns).rows, {}).rows
    expect(values(rows, 'sales_rep', 'amount')).toEqual([
      ['Asha', 70000],
      ['Asha', 60000],
      ['Asha', 50000],
      ['Vikram', 90000],
      ['Vikram', 40000],
      ['Vikram', 30000],
    ])
    const text = valid(recipe([{ id: 's1', type: 'sort', by: [{ column: 'region', direction: 'asc' }] }], {}, { region: 'string' }))
    expect(execute(text, [{ region: 'b' }, { region: 'Z' }, { region: 'a' }, { region: 'É' }], {}).rows.map((r) => r.region)).toEqual(['Z', 'a', 'b', 'É'])
  })

  it('describes every step in plain words', () => {
    const def = valid(topRegions({ parameter: 'top_n' }))
    expect(describeRecipe(def)).toEqual([
      'Keep rows where status equals "paid"',
      'Group by region: total amount as revenue',
      'Sort by revenue (highest first)',
      'Keep the first top_n (2) rows',
      'Keep columns region as "Region", revenue as "Paid revenue"',
    ])
  })
})

describe('text filters', () => {
  it('"contains" ignores capitals; "is one of" matches exactly', () => {
    const contains = valid(recipe([{ id: 's1', type: 'filter', column: 'sales_rep', operator: 'contains', value: { literal: 'ASH' } }]))
    expect(runFixture(contains, 'sales_A.csv').rows.map((r) => r.amount)).toEqual([60000, 50000, 70000])
    expect(describeRecipe(contains)).toEqual(['Keep rows where sales_rep contains "ASH" (ignoring capitals)'])

    const oneOf = valid(recipe([{ id: 's1', type: 'filter', column: 'region', operator: 'in', value: { list: ['North', 'West', 'north'] } }]))
    expect(runFixture(oneOf, 'sales_A.csv').rows).toHaveLength(4)
    expect(summarize(oneOf, {}, 4)).toBe('4 rows · region in (North, West, north)')
  })
})

describe('whole-number columns', () => {
  const ORDERS = 'order_id,product,units,price\nA,pen,3,10\nB,pen,4,10\nC,ink,5,120\n'

  it('parse strictly, stay numbers (not rupees) through a summary, and compare like amounts', () => {
    const def = valid(
      recipe(
        [
          { id: 's1', type: 'filter', column: 'units', operator: 'gte', value: { literal: 4 } },
          { id: 's2', type: 'aggregate', groupBy: ['product'], measures: [{ op: 'sum', column: 'units', as: 'units' }, { op: 'avg', column: 'price', as: 'avg_price' }] },
        ],
        {},
        { product: 'string', units: 'integer', price: 'integer_inr' },
      ),
    )
    const result = execute(def, parseForContract(ORDERS, def.input.columns).rows, {})
    expect(result.rows).toEqual([
      { product: 'ink', units: 5, avg_price: 120 },
      { product: 'pen', units: 4, avg_price: 10 },
    ])
    expect(result.columns).toEqual([
      { name: 'product', type: 'string' },
      { name: 'units', type: 'integer' },
      { name: 'avg_price', type: 'integer_inr' },
    ])
    expect(describeRecipe(def)[0]).toBe('Keep rows where units is at least 4')
    expect(checkWholeNumber('1.5')).toEqual({ ok: false, problem: '"1.5" has decimals; use whole numbers (nothing is rounded)' })
    expect(() => parseForContract('units\n1,000\n', { units: 'integer' })).toThrow(CsvError)
  })

  it('are suggested for count-like names; other number columns stay amounts', () => {
    const inferred = inferColumns('order_id,product,qty,units_sold,amount,price\nA,pen,3,4,100,10\n').columns
    expect(Object.fromEntries(inferred.map((c) => [c.name, c.type]))).toEqual({
      order_id: 'string',
      product: 'string',
      qty: 'integer',
      units_sold: 'integer',
      amount: 'integer_inr',
      price: 'integer_inr',
    })
  })
})

describe('validation of the new steps', () => {
  it('checks summary figures: counts take no column, totals need a number column, names are unique', () => {
    const messages = issuesOf(
      recipe([
        {
          id: 's1',
          type: 'aggregate',
          groupBy: ['amount'],
          measures: [
            { op: 'count', column: 'region', as: 'n' } as never,
            { op: 'sum', column: 'region', as: 'total' },
            { op: 'avg', column: 'amount', as: 'total' },
          ],
        },
      ]),
    )
    expect(messages).toEqual(
      expect.arrayContaining([
        '"amount" is an amount column. Group by text or whole-number columns',
        'A count counts rows; it takes no column',
        '"region" is a text column. Choose an amount or whole-number column',
        'Two columns would be called "total". Choose another name',
      ]),
    )
  })

  it('explains columns that a summary removed or a column choice renamed', () => {
    const afterSummary = issuesOf(
      recipe([
        { id: 's1', type: 'aggregate', groupBy: ['region'], measures: [{ op: 'count', as: 'orders' }] },
        { id: 's2', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
      ]),
    )
    expect(afterSummary).toContain('Column "status" is no longer available: step s1 summarized the rows, which keeps only "region", "orders"')
    const afterRename = issuesOf(
      recipe([
        { id: 's1', type: 'select', columns: [{ column: 'region', as: 'Region' }, { column: 'amount' }] },
        { id: 's2', type: 'sort', by: [{ column: 'region', direction: 'asc' }] },
      ]),
    )
    expect(afterRename).toContain('Column "region" is no longer available: step s1 renamed it to "Region"')
  })

  it('checks sorts, limits, lists and column choices', () => {
    expect(issuesOf(recipe([{ id: 's1', type: 'sort', by: [{ column: 'amount', direction: 'desc' }, { column: 'amount', direction: 'asc' }] }]))).toContain(
      '"amount" is already a sort key',
    )
    expect(issuesOf(recipe([{ id: 's1', type: 'limit', rows: { literal: 0 } }]))).toContain('Keep at least 1 row')
    expect(
      issuesOf(recipe([{ id: 's1', type: 'limit', rows: { parameter: 'n' } }], { n: { type: 'integer', default: 5, min: 0, max: 10 } })),
    ).toContain('Parameter "n" needs a minimum of at least 1 to choose how many rows to keep')
    expect(issuesOf(recipe([{ id: 's1', type: 'filter', column: 'region', operator: 'in', value: { literal: 'North' } }]))).toContain(
      '"is one of" needs a list of values, like North, South',
    )
    expect(issuesOf(recipe([{ id: 's1', type: 'filter', column: 'region', operator: 'eq', value: { list: ['North'] } }]))).toContain(
      'A list of values only works with "is one of"',
    )
    expect(issuesOf(recipe([{ id: 's1', type: 'select', columns: [{ column: 'region', as: 'x' }, { column: 'status', as: 'x' }] }]))).toContain(
      'Two columns would be called "x". Choose another name',
    )
  })
})

describe('seeded examples', () => {
  it('are all valid, and the top-reps example ranks sales_A', () => {
    for (const example of SEED_EXAMPLES) expect(validateDefinition(example.definition).ok, example.key).toBe(true)
    const result = runFixture(TOP_REPS_BY_REVENUE, 'sales_A.csv', { top_n: 3 })
    expect(result.rows).toEqual([
      { 'Sales rep': 'Asha', 'Paid revenue': 180000, Orders: 3, 'Average deal': 60000 },
      { 'Sales rep': 'Vikram', 'Paid revenue': 40000, Orders: 1, 'Average deal': 40000 },
    ])
  })
})

describe('through the API', () => {
  let app: Awaited<ReturnType<typeof freshApp>>
  beforeEach(async () => {
    app = await freshApp()
  })

  it('saves and runs a top-N summary, and exports it as CSV with its headers', async () => {
    expect(app.seed.users.asha).toBeTruthy()
    const asha = await signIn('asha')
    const def = recipe(
      [
        PAID,
        {
          id: 's2',
          type: 'aggregate',
          groupBy: ['sales_rep'],
          measures: [
            { op: 'count', as: 'orders' },
            { op: 'sum', column: 'amount', as: 'revenue' },
          ],
        },
        { id: 's3', type: 'sort', by: [{ column: 'revenue', direction: 'desc' }] },
        { id: 's4', type: 'limit', rows: { literal: 1 } },
        { id: 's5', type: 'select', columns: [{ column: 'sales_rep', as: 'Top rep' }, { column: 'orders', as: 'Orders' }, { column: 'revenue', as: 'Revenue' }] },
      ],
    )
    const created = await asha.post('/api/workflows', { title: 'Top rep this month', definition: def })
    expect(created.status).toBe(201)
    const run = await asha.run(created.body.version.id, fixture('sales_A.csv'))
    expect(run.status).toBe(201)
    expect(run.body.rows).toEqual([{ 'Top rep': 'Asha', Orders: 3, Revenue: 180000 }])
    expect(run.body.summary).toBe('1 row · status = "paid" · grouped by sales_rep · sorted by revenue ↓ · first 1')
    expect(run.body.stepLog.map((s: { type: string; rowsOut: number }) => [s.type, s.rowsOut])).toEqual([
      ['filter', 4],
      ['aggregate', 2],
      ['sort', 2],
      ['limit', 1],
      ['select', 1],
    ])
    const csv = await asha.get(`/api/runs/${run.body.id}/csv`)
    expect(csv.text).toBe('Top rep,Orders,Revenue\r\nAsha,3,180000')
  })
})
