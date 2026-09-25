import { describe, expect, it } from 'vitest'
import { execute, ExecutionError, compareCodePoints } from '../src/lib/workflow/execute'
import { summarize, formatINR } from '../src/lib/workflow/describe'
import { resolveParameters } from '../src/lib/workflow/validate'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL, groupedBy } from '../src/lib/workflow/examples'
import type { WorkflowDefinition } from '../src/lib/workflow/schema'
import { runFixture } from './helpers/fixtures'

const byRegion = (rows: Record<string, string | number>[]) => rows.map((r) => [r.region, r.total])

describe('engine: the demo expectations', () => {
  it('original · file A · threshold 100,000 → South 40,000; West 70,000 (North 110,000 excluded)', () => {
    const result = runFixture(ORIGINAL, 'sales_A.csv', { threshold: 100000 })
    expect(byRegion(result.rows)).toEqual([
      ['South', 40000],
      ['West', 70000],
    ])
    expect(result.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'total', type: 'integer_inr' },
    ])
  })

  it('original · file B · 100,000 → North 70,000; West 20,000 (South 120,000 excluded)', () => {
    const result = runFixture(ORIGINAL, 'sales_B.csv', { threshold: 100000 })
    expect(byRegion(result.rows)).toEqual([
      ['North', 70000],
      ['West', 20000],
    ])
  })

  it('original · file B · 50,000 → West 20,000 only, and the saved definition is unchanged', () => {
    const before = structuredClone(ORIGINAL)
    const result = runFixture(ORIGINAL, 'sales_B.csv', { threshold: '50000' })
    expect(byRegion(result.rows)).toEqual([['West', 20000]])
    expect(ORIGINAL).toEqual(before)
    expect(ORIGINAL.parameters.threshold).toMatchObject({ default: 100000 })
  })

  it('fork grouped by sales_rep · file B · 100,000 → Asha 90,000 only (Vikram 120,000 excluded)', () => {
    const fork = groupedBy(ORIGINAL, 'sales_rep')
    const result = runFixture(fork, 'sales_B.csv', { threshold: 100000 })
    expect(result.rows).toEqual([{ sales_rep: 'Asha', total: 90000 }])
  })

  it('original · file A · 70,000 (boundary) → South only; West = 70,000 is excluded by lt', () => {
    const result = runFixture(ORIGINAL, 'sales_A.csv', { threshold: 70000 })
    expect(byRegion(result.rows)).toEqual([['South', 40000]])
  })

  it('lte keeps the row at equality where lt drops it', () => {
    const lte: WorkflowDefinition = {
      ...ORIGINAL,
      steps: ORIGINAL.steps.map((s) => (s.id === 's3' && s.type === 'filter' ? { ...s, operator: 'lte' as const } : s)),
    }
    const result = runFixture(lte, 'sales_A.csv', { threshold: 70000 })
    expect(byRegion(result.rows)).toEqual([
      ['South', 40000],
      ['West', 70000],
    ])
  })

  it('original · file B · 20,000 → an empty table, summarised as "No rows matched"', () => {
    const result = runFixture(ORIGINAL, 'sales_B.csv', { threshold: 20000 })
    expect(result.rows).toEqual([])
    expect(summarize(ORIGINAL, result.params, result.rows.length)).toBe('No rows matched')
  })
})

describe('engine: rules', () => {
  it('excludes refunds and cancellations with an exact, case-sensitive match', () => {
    const paidOnly: WorkflowDefinition = { ...ORIGINAL, parameters: {}, steps: [ORIGINAL.steps[0]!] }
    const result = runFixture(paidOnly, 'sales_A.csv')
    expect(result.rows.map((r) => r.status)).toEqual(['paid', 'paid', 'paid', 'paid'])
    expect(result.rows.map((r) => r.amount)).toEqual([60000, 50000, 40000, 70000]) // row order preserved

    const capitalised: WorkflowDefinition = {
      ...paidOnly,
      steps: [{ id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'Paid' } }],
    }
    expect(runFixture(capitalised, 'sales_A.csv').rows).toEqual([])
  })

  it('records rows in and out for every step', () => {
    const result = runFixture(ORIGINAL, 'sales_A.csv', { threshold: 100000 })
    expect(result.stepLog.map(({ stepId, type, rowsIn, rowsOut }) => ({ stepId, type, rowsIn, rowsOut }))).toEqual([
      { stepId: 's1', type: 'filter', rowsIn: 6, rowsOut: 4 },
      { stepId: 's2', type: 'group_sum', rowsIn: 4, rowsOut: 3 },
      { stepId: 's3', type: 'filter', rowsIn: 3, rowsOut: 2 },
    ])
    for (const entry of result.stepLog) expect(entry.ms).toBeGreaterThanOrEqual(0)
  })

  it('produces the same rows and summary line every time', () => {
    const a = runFixture(ORIGINAL, 'sales_A.csv', { threshold: 100000 })
    const b = runFixture(ORIGINAL, 'sales_A.csv', { threshold: 100000 })
    expect(a.rows).toEqual(b.rows)
    const line = summarize(ORIGINAL, a.params, a.rows.length)
    expect(line).toBe('2 rows · status = "paid" · grouped by region · total < ₹1,00,000')
    expect(summarize(ORIGINAL, b.params, b.rows.length)).toBe(line)
    expect(formatINR(100000)).toBe('₹1,00,000')
    expect(formatINR(10000000)).toBe('₹1,00,00,000')
  })

  it('stops with TIMEOUT once the deadline passes', () => {
    let t = 0
    const clock = () => (t += 1000) // every reading advances one second
    const rows = Array.from({ length: 10 }, (_, i) => ({ status: 'paid', region: `R${i}`, sales_rep: 'x', amount: i }))
    let caught: unknown
    try {
      execute(ORIGINAL, rows, { threshold: 100 }, { deadlineMs: 2500, now: clock })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ExecutionError)
    expect((caught as ExecutionError).code).toBe('TIMEOUT')
  })

  it('sorts groups by code point, not by locale or UTF-16 unit', () => {
    const keys = ['b', 'B', 'a', 'é', '😀', '�']
    const rows = keys.map((k) => ({ status: 'paid', region: k, sales_rep: 'x', amount: 1 }))
    const def: WorkflowDefinition = { ...ORIGINAL, parameters: {}, steps: [ORIGINAL.steps[1]!] }
    const result = execute(def, rows, {})
    expect(result.rows.map((r) => r.region)).toEqual(['B', 'a', 'b', 'é', '�', '😀'])
    // Plain .sort() compares UTF-16 units and would put the emoji before U+FFFD.
    expect([...keys].sort()).not.toEqual(result.rows.map((r) => r.region))
    expect(compareCodePoints('😀', '�')).toBeGreaterThan(0)
  })

  it('checks run parameters against their declared bounds without touching the recipe', () => {
    expect(resolveParameters(ORIGINAL, {})).toEqual({ ok: true, values: { threshold: 100000 } })
    expect(resolveParameters(ORIGINAL, { threshold: '50000' })).toEqual({ ok: true, values: { threshold: 50000 } })

    const tooBig = resolveParameters(ORIGINAL, { threshold: 1_000_000_001 })
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.issues[0]!.message).toMatch(/between ₹0 and ₹1,00,00,00,000/)

    for (const bad of [-1, 12.5, 'abc', '1e5', true]) expect(resolveParameters(ORIGINAL, { threshold: bad }).ok).toBe(false)

    const unknown = resolveParameters(ORIGINAL, { limit: 5 })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.issues[0]!.message).toBe('Unknown parameter "limit". This recipe has "threshold"')
  })
})
