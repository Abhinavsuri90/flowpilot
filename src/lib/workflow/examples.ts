import type { WorkflowDefinition } from './schema'

// Hand-authored definitions. The seed examples are labelled "Example" in the UI
// and are never presented as model output.

/** The demo recipe Asha builds live: keep paid orders, total by region, show regions below a threshold. */
export const REGIONAL_REVENUE_EXCEPTIONS: WorkflowDefinition = {
  schemaVersion: 1,
  input: {
    format: 'csv',
    columns: { status: 'string', region: 'string', sales_rep: 'string', amount: 'integer_inr' },
  },
  parameters: {
    threshold: { type: 'integer', default: 100000, min: 0, max: 1000000000 },
  },
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    { id: 's2', type: 'group_sum', groupBy: 'region', valueColumn: 'amount', as: 'total' },
    { id: 's3', type: 'filter', column: 'total', operator: 'lt', value: { parameter: 'threshold' } },
  ],
  output: { format: 'table' },
}

export const REGIONAL_REVENUE_REQUEST =
  'Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000.'

/** Vikram's copy in the demo: the same recipe grouped by sales rep. */
export function groupedBy(def: WorkflowDefinition, column: string): WorkflowDefinition {
  return {
    ...def,
    steps: def.steps.map((s) => (s.type === 'group_sum' ? { ...s, groupBy: column } : s)),
  }
}

/** Seed example in Sales (owner Vikram, shared with the team). */
export const PAID_BY_SALES_REP: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { status: 'string', sales_rep: 'string', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    { id: 's2', type: 'group_sum', groupBy: 'sales_rep', valueColumn: 'amount', as: 'paid_total' },
  ],
  output: { format: 'table' },
}

/** Seed example in Marketing (owner Olivia, shared with Marketing only). Proves tenant isolation. */
export const LIVE_SPEND_BY_CHANNEL: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { status: 'string', channel: 'string', spend: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'live' } },
    { id: 's2', type: 'group_sum', groupBy: 'channel', valueColumn: 'spend', as: 'total_spend' },
  ],
  output: { format: 'table' },
}

/** Seed example in Sales (owner Vikram): a summary, a sort, an adjustable top N and friendly headers. */
export const TOP_REPS_BY_REVENUE: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { status: 'string', sales_rep: 'string', amount: 'integer_inr' } },
  parameters: { top_n: { type: 'integer', default: 3, min: 1, max: 50 } },
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    {
      id: 's2',
      type: 'aggregate',
      groupBy: ['sales_rep'],
      measures: [
        { op: 'sum', column: 'amount', as: 'revenue' },
        { op: 'count', as: 'orders' },
        { op: 'avg', column: 'amount', as: 'avg_deal' },
      ],
    },
    { id: 's3', type: 'sort', by: [{ column: 'revenue', direction: 'desc' }] },
    { id: 's4', type: 'limit', rows: { parameter: 'top_n' } },
    {
      id: 's5',
      type: 'select',
      columns: [
        { column: 'sales_rep', as: 'Sales rep' },
        { column: 'revenue', as: 'Paid revenue' },
        { column: 'orders', as: 'Orders' },
        { column: 'avg_deal', as: 'Average deal' },
      ],
    },
  ],
  output: { format: 'table' },
}

export const SEED_EXAMPLES = [
  {
    key: 'paid_by_rep',
    owner: 'vikram',
    workspace: 'Sales',
    title: 'Paid revenue by sales rep',
    description: 'Keeps paid orders and totals the amount for each sales rep. A starting point for commission checks.',
    definition: PAID_BY_SALES_REP,
  },
  {
    key: 'top_reps',
    owner: 'vikram',
    workspace: 'Sales',
    title: 'Top sales reps by paid revenue',
    description: 'Ranks reps by paid revenue, with their order count and average deal size. Choose how many to show on each run.',
    definition: TOP_REPS_BY_REVENUE,
  },
  {
    key: 'live_spend',
    owner: 'olivia',
    workspace: 'Marketing',
    title: 'Live spend by channel',
    description: 'Keeps live campaigns and totals spend per channel.',
    definition: LIVE_SPEND_BY_CHANNEL,
  },
] as const
