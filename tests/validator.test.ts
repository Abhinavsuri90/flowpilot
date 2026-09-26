import { describe, expect, it } from 'vitest'
import { analyze, validateDefinition } from '../src/lib/workflow/validate'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'
import type { WorkflowDefinition } from '../src/lib/workflow/schema'

/** A deep copy of the demo recipe with some changes applied. */
function variant(change: (def: Record<string, any>) => void): unknown {
  const copy = structuredClone(ORIGINAL) as Record<string, any>
  change(copy)
  return copy
}

function issuesOf(raw: unknown) {
  const result = validateDefinition(raw)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.issues
}

describe('validator', () => {
  it('accepts the demo recipe', () => {
    const result = validateDefinition(ORIGINAL)
    expect(result).toEqual({ ok: true, definition: ORIGINAL, issues: [] })
  })

  it('rejects any operation outside the allowlist', () => {
    const issues = issuesOf(variant((d) => d.steps.splice(1, 0, { id: 'j1', type: 'join', with: 'other.csv' })))
    expect(issues).toContainEqual({
      stepIndex: 1,
      stepId: 'j1',
      path: 'steps[1].type',
      message: 'Unsupported step type "join". Only filter, group_sum, aggregate, sort, limit and select are allowed.',
    })
  })

  it('rejects a reference to an undeclared parameter', () => {
    const issues = issuesOf(variant((d) => (d.steps[2].value = { parameter: 'limit' })))
    expect(issues).toContainEqual(
      expect.objectContaining({
        stepId: 's3',
        path: 'steps[2].value.parameter',
        message: 'Parameter "limit" is not declared. Add it under Parameters, or use a fixed value',
      }),
    )
  })

  it('explains exactly why a column is gone after grouping', () => {
    const issues = issuesOf(variant((d) => (d.steps[2] = { id: 's3', type: 'filter', column: 'sales_rep', operator: 'eq', value: { literal: 'Asha' } })))
    expect(issues).toContainEqual({
      stepIndex: 2,
      stepId: 's3',
      path: 'steps[2].column',
      message: 'Column "sales_rep" is no longer available: step s2 grouped the rows, which keeps only "region" and "total"',
    })
  })

  it('allows lt/lte/gt/gte only on numbers, and contains / is one of only on text', () => {
    const issues = issuesOf(variant((d) => (d.steps[0].operator = 'lt')))
    expect(issues.map((i) => i.message)).toContain(
      '"lt" compares numbers, but "status" is a text column. Use equals, does not equal, contains or is one of',
    )
    const onAmount = issuesOf(variant((d) => (d.steps[2].operator = 'contains')))
    expect(onAmount.map((i) => i.message)).toContain('"contains" works on text, but "total" is a number column')
  })

  it('rejects duplicate step ids', () => {
    const issues = issuesOf(variant((d) => (d.steps[1].id = 's1')))
    expect(issues).toContainEqual(expect.objectContaining({ stepIndex: 1, message: 'Step id "s1" is used more than once' }))
  })

  it('allows at most 10 steps', () => {
    const issues = issuesOf(
      variant((d) => {
        d.steps = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, type: 'filter', column: 'status', operator: 'neq', value: { literal: 'x' } }))
      }),
    )
    expect(issues.map((i) => i.message)).toContain('A recipe can have at most 10 steps')
    expect(issuesOf(variant((d) => (d.steps = []))).map((i) => i.message)).toContain('A recipe needs at least one step')
  })

  it('rejects a group_sum alias equal to the group-by column', () => {
    const issues = issuesOf(variant((d) => (d.steps[1].as = 'region')))
    expect(issues.map((i) => i.message)).toContain(`The new column can't also be named "region", the group-by column`)
  })

  it('rejects unknown keys at every level', () => {
    const top = issuesOf(variant((d) => (d.owner_id = 'usr_x')))
    expect(top.map((i) => i.message)).toContain('Unknown field "owner_id"')
    const nested = issuesOf(variant((d) => (d.steps[0].expression = 'amount * 2')))
    expect(nested).toContainEqual(
      expect.objectContaining({ stepIndex: 0, message: 'Unknown field "expression" in steps[0]' }),
    )
  })

  it('checks that values match their column type', () => {
    expect(issuesOf(variant((d) => (d.steps[2].value = { literal: '100000' }))).map((i) => i.message)).toContain(
      '"total" is an amount column, so the value must be a whole number of rupees',
    )
    expect(issuesOf(variant((d) => (d.steps[0].value = { literal: 7 }))).map((i) => i.message)).toContain(
      '"status" is a text column, so the value must be text',
    )
    expect(issuesOf(variant((d) => (d.steps[0].value = { parameter: 'threshold' }))).map((i) => i.message)).toContain(
      'Parameter "threshold" is a number, but "status" is a text column',
    )
    expect(
      issuesOf(variant((d) => (d.steps[2].value = { literal: 5, parameter: 'threshold' }))).map((i) => i.message),
    ).toContain('A value is exactly one of {"literal": …}, {"parameter": "<name>"} or {"list": […]}')
  })

  it('enforces 0 ≤ min ≤ default ≤ max ≤ 1,000,000,000 for integer parameters', () => {
    expect(issuesOf(variant((d) => (d.parameters.threshold.default = 2_000_000_000))).map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/threshold: the default ₹2,00,00,00,000 must be between/)]),
    )
    expect(issuesOf(variant((d) => (d.parameters.threshold.max = 2_000_000_000))).map((i) => i.message)).toContain(
      'threshold: max can be at most ₹1,00,00,00,000',
    )
    expect(issuesOf(variant((d) => (d.parameters.threshold.min = -1))).map((i) => i.message)).toContain(
      'threshold: min cannot be negative',
    )
    expect(
      issuesOf(variant((d) => (d.parameters.note = { type: 'string', default: 'x'.repeat(201) }))).map((i) => i.path),
    ).toContain('parameters.note.default')
  })

  it('requires schemaVersion 1, csv input and table output', () => {
    const messages = issuesOf(
      variant((d) => {
        d.schemaVersion = 2
        d.input.format = 'xlsx'
        d.output.format = 'chart'
      }),
    ).map((i) => i.message)
    expect(messages).toEqual(
      expect.arrayContaining(['schemaVersion must be 1', 'input.format must be "csv"', 'output.format must be "table"']),
    )
  })

  it('tracks available columns through a partial draft for the editor', () => {
    const draft = {
      input: { columns: { status: 'string', region: 'string', amount: 'integer_inr' } },
      steps: [
        { id: 's1', type: 'filter', column: '', operator: 'eq' },
        { id: 's2', type: 'group_sum', groupBy: 'region', valueColumn: 'amount', as: 'total' },
        { id: 's3', type: 'filter' },
      ],
    }
    const analysis = analyze(draft)
    expect(analysis.stages.map((s) => s.available.map((c) => c.name))).toEqual([
      ['status', 'region', 'amount'],
      ['status', 'region', 'amount'],
      ['region', 'total'],
    ])
    expect(analysis.stages[1]!.removed).toEqual(['status', 'amount'])
    expect(analysis.final).toEqual([
      { name: 'region', type: 'string' },
      { name: 'total', type: 'integer_inr' },
    ])
    expect((ORIGINAL satisfies WorkflowDefinition).steps).toHaveLength(3)
  })
})
