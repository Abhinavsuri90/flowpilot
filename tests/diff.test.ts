import { describe, expect, it } from 'vitest'
import { diffDefinitions, diffLines } from '../src/lib/workflow/diff'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'
import type { WorkflowDefinition } from '../src/lib/workflow/schema'

// "Changes from v1": columns, parameters and steps compared in plain words.

describe('version changes', () => {
  it('names changed defaults and ranges, added and removed columns and parameters', () => {
    const next: WorkflowDefinition = {
      ...ORIGINAL,
      input: { format: 'csv', columns: { status: 'string', region: 'string', amount: 'integer', ordered_on: 'date' } },
      parameters: {
        threshold: { type: 'integer', default: 80000, min: 0, max: 500000 },
        from_date: { type: 'date', default: '2026-04-01' },
      },
    }
    const diff = diffDefinitions(ORIGINAL, next)
    expect(diff.columns).toEqual([
      { kind: 'changed', text: 'amount: amount (whole INR) → whole number (count or quantity)' },
      { kind: 'added', text: 'ordered_on (date (YYYY-MM-DD))' },
      { kind: 'removed', text: 'sales_rep' },
    ])
    expect(diff.parameters).toEqual([
      { kind: 'changed', text: 'threshold: default ₹1,00,000 → ₹80,000' },
      { kind: 'changed', text: 'threshold: allowed ₹0–₹1,00,00,00,000 → ₹0–₹5,00,000' },
      { kind: 'added', text: 'from_date (default 1 Apr 2026)' },
    ])
    expect(diff.steps).toEqual([])
    expect(diff.all.map((c) => c.group)).toEqual(['column', 'column', 'column', 'parameter', 'parameter', 'parameter'])
  })

  it('shows step edits as what went and what came, keeping untouched steps out of the list', () => {
    const next: WorkflowDefinition = {
      ...ORIGINAL,
      steps: [
        ORIGINAL.steps[0]!,
        { id: 's2', type: 'sort', by: [{ column: 'amount', direction: 'desc' }] },
        { ...ORIGINAL.steps[1]!, id: 's3' },
        { id: 's4', type: 'filter', column: 'total', operator: 'lt', value: { parameter: 'threshold' } },
      ],
    }
    expect(diffDefinitions(ORIGINAL, next).steps).toEqual([{ kind: 'added', text: 'Sort by amount (highest first)' }])
    const renamed: WorkflowDefinition = {
      ...ORIGINAL,
      steps: ORIGINAL.steps.map((s) => (s.type === 'group_sum' ? { ...s, as: 'revenue' } : s.type === 'filter' && s.column === 'total' ? { ...s, column: 'revenue' } : s)),
    }
    const changes = diffDefinitions(ORIGINAL, renamed).steps
    expect(changes.map((c) => c.kind)).toEqual(['removed', 'removed', 'added', 'added'])
    expect(changes[2]!.text).toBe('Total amount by region as revenue')
    expect(changes[3]!.text).toBe('Keep rows where revenue is less than threshold')
  })

  it('reports nothing when only the title or description changed', () => {
    expect(diffDefinitions(ORIGINAL, { ...ORIGINAL }).all).toEqual([])
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual([{ kind: 'added', text: 'x' }])
    expect(diffLines(['a', 'b', 'c'], ['b'])).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'c' },
    ])
    expect(diffLines(['a', 'b'], ['a', 'x'])).toEqual([
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
    ])
  })
})
