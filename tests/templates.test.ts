import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../src/lib/workflow/templates'
import { SAMPLE_FILES } from '../src/lib/samples'
import { validateDefinition, resolveParameters } from '../src/lib/workflow/validate'
import { parseForContract } from '../src/lib/csv'
import { execute } from '../src/lib/workflow/execute'
import { datePart } from '../src/lib/dates'

// Every template is a hand-written recipe with a matching sample file. Each one
// must validate, and run on its sample to a known result as of 27 Sep 2026.

const AS_OF = '2026-09-27'
const sampleText = (name: string) => readFileSync(`public/samples/${name}`, 'utf8')

function run(key: string, params: Record<string, unknown> = {}) {
  const template = TEMPLATES.find((t) => t.key === key)!
  const valid = validateDefinition(template.definition)
  if (!valid.ok) throw new Error(valid.issues.map((i) => i.message).join('; '))
  const resolved = resolveParameters(valid.definition, params)
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => i.message).join('; '))
  const parsed = parseForContract(sampleText(template.sample), valid.definition.input.columns)
  return execute(valid.definition, parsed.rows, resolved.values, { asOf: AS_OF })
}

describe('templates', () => {
  it('every template validates, has unique keys, and its sample file has every column it needs', () => {
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length)
    for (const template of TEMPLATES) {
      const result = validateDefinition(template.definition)
      expect(result.ok, template.key).toBe(true)
      const sample = SAMPLE_FILES.find((s) => s.name === template.sample)!
      expect(sample, template.key).toBeDefined()
      for (const column of Object.keys(template.definition.input.columns)) expect(sample.columns as readonly string[], `${template.key} needs ${column}`).toContain(column)
      expect(template.tags.length, template.key).toBeGreaterThan(0)
      expect(template.request.length, template.key).toBeGreaterThan(10)
    }
  })

  it('runs on its sample to the expected rows', () => {
    expect(run('regional_exceptions').rows).toEqual([
      { region: 'South', total: 40000 },
      { region: 'West', total: 70000 },
    ])
    expect(run('paid_by_rep').rows).toEqual([
      { sales_rep: 'Asha', paid_total: 180000 },
      { sales_rep: 'Vikram', paid_total: 40000 },
    ])
    expect(run('top_reps').rows.map((r) => r['Sales rep'])).toEqual(['Asha', 'Vikram'])
    expect(run('top_reps', { top_n: 1 }).rows).toHaveLength(1)
    expect(run('avg_deal_by_region').rows).toEqual([
      { region: 'West', avg_deal: 70000, orders: 1, largest: 70000 },
      { region: 'North', avg_deal: 55000, orders: 2, largest: 60000 },
      { region: 'South', avg_deal: 40000, orders: 1, largest: 40000 },
    ])
    expect(run('lost_orders_by_rep').rows).toEqual([{ sales_rep: 'Vikram', lost_orders: 2, lost_amount: 120000 }])
    expect(run('live_spend').rows.length).toBeGreaterThan(0)
  })

  it('the dated templates count from the run day', () => {
    const monthly = run('monthly_revenue')
    expect(monthly.rows.map((r) => r.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect(monthly.rows[5]).toEqual({ month: '2026-09', revenue: 206000, orders: 4, last_order: '2026-09-26' })

    expect(run('refunds_last_quarter').rows).toEqual([{ region: 'South', refunded: 22000, refunds: 1 }])

    const large = run('large_orders_since')
    expect(large.rows).toHaveLength(10)
    expect(large.rows[0]).toEqual({ Order: 'O-215', 'Ordered on': '2026-07-28', Region: 'West', 'Sales rep': 'Asha', Amount: 90000 })
    expect(run('large_orders_since', { min_amount: 80000, from_date: '2026-06-01' }).rows.map((r) => r.Order)).toEqual(['O-215'])

    const weekly = run('weekly_orders')
    const weeks = new Set(parseForContract(sampleText('orders_dated.csv'), { ordered_on: 'date' }).rows.map((r) => datePart(String(r.ordered_on), 'week')))
    expect(weekly.rows).toHaveLength(weeks.size)
    expect(weekly.rows.reduce((n, r) => n + Number(r.orders), 0)).toBe(22)
    expect(weekly.rows.map((r) => r.week)).toEqual([...weeks].sort())
  })
})
