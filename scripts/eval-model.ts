// Offline eval set for AI drafting: fixed requests with structural expectations.
// Runs each case against the configured model (or every --model given) and
// prints pass/fail, latency and repairs. Costs a few cents at most.
//   npm run eval:model
//   npm run eval:model -- --model openai/gpt-6-luna --model anthropic/claude-sonnet-5
import { loadEnv } from '../src/server/env'
import { modelStatus } from '../src/server/ai/config'
import { generateRecipe } from '../src/server/ai/generate'
import { ApiError } from '../src/server/http'
import { describeRecipe } from '../src/lib/workflow/describe'
import type { ColumnType, Step, WorkflowDefinition } from '../src/lib/workflow/schema'
import type { GenerateResult } from '../src/lib/types'

type Columns = Record<string, ColumnType>
const SALES: Columns = { status: 'string', region: 'string', sales_rep: 'string', amount: 'integer_inr' }
const MARKETING: Columns = { status: 'string', channel: 'string', spend: 'integer_inr' }
const TWO_REPS: Columns = { status: 'string', sales_rep: 'string', account_rep: 'string', amount: 'integer_inr' }
const ORDERS: Columns = { ordered_on: 'date', status: 'string', region: 'string', sales_rep: 'string', amount: 'integer_inr' }
const relative = (d: WorkflowDefinition, column: string, operator: string[], unit: string, offset: number, edge?: string) =>
  d.steps.some(
    (s) =>
      s.type === 'filter' &&
      s.column === column &&
      operator.includes(s.operator) &&
      'relative' in s.value &&
      s.value.relative.unit === unit &&
      s.value.relative.offset === offset &&
      (!edge || s.value.relative.edge === edge),
  )
const period = (d: WorkflowDefinition, column: string, part: string) => d.steps.some((s) => s.type === 'date_part' && s.column === column && s.part === part)
const groupedBy = (d: WorkflowDefinition, column: string) =>
  d.steps.some((s) => (s.type === 'group_sum' && s.groupBy === column) || (s.type === 'aggregate' && s.groupBy.includes(column)))
const dateParam = (d: WorkflowDefinition) => Object.values(d.parameters).some((p) => p.type === 'date')

const filter = (d: WorkflowDefinition, column: string, operator: string[], value?: (v: unknown) => boolean) =>
  d.steps.some(
    (s: Step) =>
      s.type === 'filter' &&
      s.column === column &&
      operator.includes(s.operator) &&
      (!value ||
        ('literal' in s.value
          ? value(s.value.literal)
          : 'parameter' in s.value
            ? value(d.parameters[s.value.parameter]?.default)
            : 'list' in s.value
              ? value(s.value.list)
              : value(s.value.relative))),
  )
const groupSum = (d: WorkflowDefinition, groupBy: string, valueColumn: string) =>
  d.steps.some((s) => s.type === 'group_sum' && s.groupBy === groupBy && s.valueColumn === valueColumn)
const param = (d: WorkflowDefinition, dflt: number) => Object.values(d.parameters).some((p) => p.type === 'integer' && p.default === dflt)
const aliasFilter = (d: WorkflowDefinition, operator: string[]) => {
  const g = d.steps.find((s) => s.type === 'group_sum' || s.type === 'aggregate')
  if (g?.type === 'group_sum') return filter(d, g.as, operator)
  if (g?.type === 'aggregate') return g.measures.some((m) => filter(d, m.as, operator))
  return false
}
const aggregate = (d: WorkflowDefinition, groupBy: string[], op: string, column?: string) =>
  d.steps.some(
    (s) =>
      s.type === 'aggregate' &&
      JSON.stringify(s.groupBy) === JSON.stringify(groupBy) &&
      s.measures.some((m) => m.op === op && (op === 'count' || ('column' in m && m.column === column))),
  )
/** One total per group, whichever grouping step the model chose. */
const totalPer = (d: WorkflowDefinition, groupBy: string, column: string) => groupSum(d, groupBy, column) || aggregate(d, [groupBy], 'sum', column)
const sortedDesc = (d: WorkflowDefinition) => d.steps.some((s) => s.type === 'sort' && s.by[0]?.direction === 'desc')
const firstN = (d: WorkflowDefinition, n: number) =>
  d.steps.some((s) => s.type === 'limit' && ('literal' in s.rows ? s.rows.literal === n : d.parameters[s.rows.parameter]?.default === n))
const listFilter = (d: WorkflowDefinition, column: string, values: string[]) =>
  d.steps.some((s) => s.type === 'filter' && s.column === column && s.operator === 'in' && 'list' in s.value && values.every((v) => (s.value as { list: string[] }).list.includes(v)))

type Case = {
  name: string
  request: string
  columns: Columns
  kind: GenerateResult['kind']
  check?: (d: WorkflowDefinition) => boolean
}

const CASES: Case[] = [
  {
    name: 'demo sentence',
    request: 'Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && groupSum(d, 'region', 'amount') && aliasFilter(d, ['lt']) && param(d, 100000),
  },
  {
    name: 'two filters',
    request: 'Show only refunded orders with an amount above 50000.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'refunded') && filter(d, 'amount', ['gt'], (v) => v === 50000),
  },
  {
    name: 'group by rep',
    request: 'Total paid amount for each sales rep.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && groupSum(d, 'sales_rep', 'amount'),
  },
  {
    name: 'at least, adjustable',
    request: 'Which regions have paid revenue of at least an adjustable amount, default 80000?',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && groupSum(d, 'region', 'amount') && aliasFilter(d, ['gte']) && param(d, 80000),
  },
  {
    name: 'exclusion',
    request: 'Leave out cancelled orders and total the amount by region.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['neq'], (v) => v === 'cancelled') && groupSum(d, 'region', 'amount'),
  },
  {
    name: 'other contract',
    request: 'Total live spend per channel.',
    columns: MARKETING,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'live') && groupSum(d, 'channel', 'spend'),
  },
  {
    name: 'Hinglish',
    request: 'Paid orders ka region wise total dikhao.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && groupSum(d, 'region', 'amount'),
  },
  {
    name: 'average per region',
    request: 'Average order value by region.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => aggregate(d, ['region'], 'avg', 'amount'),
  },
  {
    name: 'count per rep',
    request: 'How many orders does each sales rep have?',
    columns: SALES,
    kind: 'workflow',
    check: (d) => aggregate(d, ['sales_rep'], 'count'),
  },
  {
    name: 'top 3 by revenue',
    request: 'Top 3 sales reps by paid revenue.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && totalPer(d, 'sales_rep', 'amount') && sortedDesc(d) && firstN(d, 3),
  },
  {
    name: 'largest per group',
    request: 'What is the largest single order in each region?',
    columns: SALES,
    kind: 'workflow',
    check: (d) => aggregate(d, ['region'], 'max', 'amount'),
  },
  {
    name: 'overall summary',
    request: 'How many paid orders are there, and what is their total amount?',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && aggregate(d, [], 'count') && aggregate(d, [], 'sum', 'amount'),
  },
  {
    name: 'one of a list',
    request: 'Keep only orders from the "North" and "West" regions.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => listFilter(d, 'region', ['North', 'West']),
  },
  {
    name: 'contains',
    request: 'Keep rows where the sales rep name contains ash, then total the amount by region.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => filter(d, 'sales_rep', ['contains'], (v) => typeof v === 'string' && v.toLowerCase() === 'ash') && totalPer(d, 'region', 'amount'),
  },
  { name: 'months → unsupported', request: 'Show paid revenue by month for the last quarter.', columns: SALES, kind: 'unsupported' },
  { name: 'percentage → unsupported', request: 'What percentage of total revenue does each region contribute?', columns: SALES, kind: 'unsupported' },
  { name: 'Gmail + schedule → unsupported', request: 'Email this report to my manager through Gmail every Monday.', columns: SALES, kind: 'unsupported' },
  { name: 'join → unsupported', request: 'Join these orders with the targets spreadsheet and compare.', columns: SALES, kind: 'unsupported' },
  { name: 'chart → unsupported', request: 'Draw a bar chart of paid revenue by region.', columns: SALES, kind: 'unsupported' },
  { name: 'ambiguous → question', request: 'Total the amount for each rep.', columns: TWO_REPS, kind: 'clarification' },
  {
    name: 'custom threshold wording',
    request: 'Sum amount by region and keep regions under 60000, a limit I want to be able to change.',
    columns: SALES,
    kind: 'workflow',
    check: (d) => groupSum(d, 'region', 'amount') && aliasFilter(d, ['lt', 'lte']) && param(d, 60000),
  },
  {
    name: 'dates: last 30 days',
    request: 'Paid orders from the last 30 days.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && relative(d, 'ordered_on', ['gte', 'gt'], 'day', -30),
  },
  {
    name: 'dates: by month',
    request: 'Total paid amount per month.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && period(d, 'ordered_on', 'month') && totalPer(d, 'month', 'amount') || (period(d, 'ordered_on', 'month') && groupedBy(d, d.steps.find((s) => s.type === 'date_part')!.type === 'date_part' ? (d.steps.find((s) => s.type === 'date_part') as { as: string }).as : 'month')),
  },
  {
    name: 'dates: last month by region',
    request: 'Revenue by region for last month, paid orders only.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) =>
      filter(d, 'status', ['eq'], (v) => v === 'paid') &&
      relative(d, 'ordered_on', ['gte'], 'month', -1, 'start') &&
      relative(d, 'ordered_on', ['lte', 'lt'], 'month', -1) &&
      totalPer(d, 'region', 'amount'),
  },
  {
    name: 'dates: since a fixed day',
    request: 'Orders placed on or after 1 April 2026 with amount above 50000.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) => filter(d, 'ordered_on', ['gte'], (v) => v === '2026-04-01') && filter(d, 'amount', ['gt'], (v) => v === 50000),
  },
  {
    name: 'dates: this quarter per rep',
    request: 'This quarter so far: paid revenue per sales rep, highest first.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) => filter(d, 'status', ['eq'], (v) => v === 'paid') && relative(d, 'ordered_on', ['gte'], 'quarter', 0, 'start') && totalPer(d, 'sales_rep', 'amount') && sortedDesc(d),
  },
  {
    name: 'dates: configurable start',
    request: 'Count of orders per week starting from a configurable date, default 2026-01-01.',
    columns: ORDERS,
    kind: 'workflow',
    check: (d) => dateParam(d) && filter(d, 'ordered_on', ['gte']) && period(d, 'ordered_on', 'week') && aggregate(d, ['week'], 'count'),
  },
  {
    name: 'dates: not a date column',
    request: 'Orders from the last 7 days.',
    columns: SALES,
    kind: 'unsupported',
  },
]

loadEnv()
const argv = process.argv.slice(2)
const models = argv.flatMap((a, i) => (a === '--model' && argv[i + 1] ? [argv[i + 1]!] : []))
const status = modelStatus()
if (!status.available) {
  console.log('Model: not configured. Set a key in .env (see .env.example), then run again.')
  process.exit(1)
}

let failures = 0
for (const model of models.length ? models : [status.model!]) {
  process.env.MODEL_NAME = model
  console.log(`\n${status.provider} · ${model}`)
  const results = await Promise.all(
    CASES.map(async (c) => {
      const started = Date.now()
      try {
        const r = await generateRecipe({ request: c.request, columns: c.columns })
        const ok = r.kind === c.kind && (r.kind !== 'workflow' || !c.check || c.check(r.definition))
        const detail =
          r.kind === 'workflow' ? `${r.repaired ? '(repaired) ' : ''}${describeRecipe(r.definition).join(' | ')}` : r.kind === 'unsupported' ? r.reason : r.question
        return { c, ok, got: r.kind, ms: Date.now() - started, detail }
      } catch (err) {
        const detail = err instanceof ApiError ? `${err.code}: ${err.message}` : String(err)
        return { c, ok: false, got: 'error', ms: Date.now() - started, detail }
      }
    }),
  )
  for (const r of results) {
    if (!r.ok) failures++
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.c.name.padEnd(30)} ${(r.ms / 1000).toFixed(1).padStart(5)} s  ${r.got.padEnd(13)} ${r.detail}`)
  }
  const times = results.map((r) => r.ms).sort((a, b) => a - b)
  const passed = results.filter((r) => r.ok).length
  console.log(`→ ${passed}/${results.length} passed · median ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(1)} s · slowest ${(times[times.length - 1]! / 1000).toFixed(1)} s`)
}
process.exit(failures ? 2 : 0)
