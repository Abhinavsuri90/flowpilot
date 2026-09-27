import { describe, expect, it } from 'vitest'
import { compareResults, comparisonSummary, type Comparison, type ResultSnapshot } from '../src/lib/compare'
import type { Column } from '../src/lib/workflow/schema'

// Comparing two results of the same recipe: rows are matched by their labels
// (text and date columns), figures are compared exactly, and anything that
// can't be matched one to one says why instead of guessing.

const BY_REGION: Column[] = [
  { name: 'region', type: 'string' },
  { name: 'total', type: 'integer_inr' },
]

function comparable(c: Comparison) {
  if (!c.comparable) throw new Error(`expected a comparison, got: ${c.detail}`)
  return c
}

describe('comparing two runs', () => {
  it('matches grouped rows by label: changed, new and gone (the demo files A then B)', () => {
    const fileA: ResultSnapshot = { columns: BY_REGION, rows: [{ region: 'South', total: 40000 }, { region: 'West', total: 70000 }] }
    const fileB: ResultSnapshot = { columns: BY_REGION, rows: [{ region: 'North', total: 70000 }, { region: 'West', total: 20000 }] }
    const c = comparable(compareResults(fileA, fileB))
    expect(c.labels).toEqual(['region'])
    expect(c.figures).toEqual(['total'])
    expect(c.changed).toEqual([{ key: ['West'], before: { region: 'West', total: 70000 }, after: { region: 'West', total: 20000 }, deltas: { total: -50000 } }])
    expect(c.added).toEqual([{ region: 'North', total: 70000 }])
    expect(c.removed).toEqual([{ region: 'South', total: 40000 }])
    expect(c.unchanged).toBe(0)
    expect(comparisonSummary(c)).toBe('1 changed · 1 new · 1 gone')
  })

  it('reports only the figures that moved, and counts rows that stayed the same', () => {
    const columns: Column[] = [
      { name: 'sales_rep', type: 'string' },
      { name: 'revenue', type: 'integer_inr' },
      { name: 'orders', type: 'integer' },
    ]
    const before: ResultSnapshot = {
      columns,
      rows: [
        { sales_rep: 'Asha', revenue: 110000, orders: 2 },
        { sales_rep: 'Vikram', revenue: 40000, orders: 1 },
        { sales_rep: 'Meera', revenue: 5000, orders: 1 },
      ],
    }
    const after: ResultSnapshot = {
      columns,
      rows: [
        { sales_rep: 'Asha', revenue: 150000, orders: 2 },
        { sales_rep: 'Vikram', revenue: 40000, orders: 1 },
        { sales_rep: 'Meera', revenue: 5000, orders: 3 },
      ],
    }
    const c = comparable(compareResults(before, after))
    expect(c.changed.map((r) => [r.key, r.deltas])).toEqual([
      [['Asha'], { revenue: 40000 }],
      [['Meera'], { orders: 2 }],
    ])
    expect(c.unchanged).toBe(1)
    expect(comparisonSummary(c)).toBe('2 changed · 1 the same')
  })

  it('matches raw rows by every text and date column together', () => {
    const columns: Column[] = [
      { name: 'order_id', type: 'string' },
      { name: 'ordered_on', type: 'date' },
      { name: 'amount', type: 'integer_inr' },
    ]
    const before: ResultSnapshot = {
      columns,
      rows: [
        { order_id: 'O-1', ordered_on: '2026-09-01', amount: 60000 },
        { order_id: 'O-2', ordered_on: '2026-09-02', amount: 50000 },
      ],
    }
    const after: ResultSnapshot = {
      columns,
      rows: [
        { order_id: 'O-1', ordered_on: '2026-09-01', amount: 65000 },
        // Same order, new date: a different row by its labels.
        { order_id: 'O-2', ordered_on: '2026-09-03', amount: 50000 },
      ],
    }
    const c = comparable(compareResults(before, after))
    expect(c.labels).toEqual(['order_id', 'ordered_on'])
    expect(c.changed.map((r) => r.key)).toEqual([['O-1', '2026-09-01']])
    expect(c.added).toEqual([{ order_id: 'O-2', ordered_on: '2026-09-03', amount: 50000 }])
    expect(c.removed).toEqual([{ order_id: 'O-2', ordered_on: '2026-09-02', amount: 50000 }])
  })

  it('compares a single overall row that has no labels', () => {
    const columns: Column[] = [
      { name: 'orders', type: 'integer' },
      { name: 'revenue', type: 'integer_inr' },
    ]
    const c = comparable(compareResults({ columns, rows: [{ orders: 4, revenue: 200000 }] }, { columns, rows: [{ orders: 5, revenue: 200000 }] }))
    expect(c.changed).toEqual([{ key: [], before: { orders: 4, revenue: 200000 }, after: { orders: 5, revenue: 200000 }, deltas: { orders: 1 } }])
  })

  it('handles empty results on either side', () => {
    const rows = [{ region: 'West', total: 20000 }]
    const filled = comparable(compareResults({ columns: BY_REGION, rows: [] }, { columns: BY_REGION, rows }))
    expect(filled.added).toEqual(rows)
    expect(comparisonSummary(filled)).toBe('1 new')
    const emptied = comparable(compareResults({ columns: BY_REGION, rows }, { columns: BY_REGION, rows: [] }))
    expect(emptied.removed).toEqual(rows)
    expect(comparisonSummary(comparable(compareResults({ columns: BY_REGION, rows: [] }, { columns: BY_REGION, rows: [] })))).toBe('No changes')
    expect(comparisonSummary(comparable(compareResults({ columns: BY_REGION, rows }, { columns: BY_REGION, rows })))).toBe('No changes (1 row the same)')
  })

  it('ignores column order but not column names or types', () => {
    const swapped: Column[] = [BY_REGION[1]!, BY_REGION[0]!]
    expect(compareResults({ columns: BY_REGION, rows: [] }, { columns: swapped, rows: [] }).comparable).toBe(true)

    const renamed = compareResults({ columns: BY_REGION, rows: [] }, { columns: [BY_REGION[0]!, { name: 'revenue', type: 'integer_inr' }], rows: [] })
    expect(renamed).toEqual({
      comparable: false,
      reason: 'columns',
      detail: "The columns changed between these runs (the result now has revenue and no longer has total), so rows can’t be matched.",
    })
    const retyped = compareResults({ columns: BY_REGION, rows: [] }, { columns: [BY_REGION[0]!, { name: 'total', type: 'integer' }], rows: [] })
    expect(retyped.comparable).toBe(false)
  })

  it('says why when rows can’t be matched one to one, instead of guessing', () => {
    const repeated = compareResults(
      { columns: BY_REGION, rows: [{ region: 'West', total: 1 }] },
      {
        columns: BY_REGION,
        rows: [
          { region: 'West', total: 1 },
          { region: 'West', total: 2 },
        ],
      },
    )
    expect(repeated).toEqual({ comparable: false, reason: 'duplicate-labels', detail: 'More than one row has region “West”, so rows can’t be matched one to one.' })

    const numbersOnly: Column[] = [{ name: 'amount', type: 'integer_inr' }]
    const unlabelled = compareResults({ columns: numbersOnly, rows: [{ amount: 1 }, { amount: 2 }] }, { columns: numbersOnly, rows: [{ amount: 1 }] })
    expect(unlabelled).toMatchObject({ comparable: false, reason: 'no-labels' })
  })
})
