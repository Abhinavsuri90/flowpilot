import type { SampleName } from '../samples'
import type { WorkflowDefinition } from './schema'
import {
  LIVE_SPEND_BY_CHANNEL,
  MONTHLY_PAID_REVENUE,
  PAID_BY_SALES_REP,
  REGIONAL_REVENUE_EXCEPTIONS,
  REGIONAL_REVENUE_REQUEST,
  TOP_REPS_BY_REVENUE,
} from './examples'

// Hand-written starting points, each paired with a sample file it runs on.
// A template loads into the editor as an ordinary draft: nothing here is model
// output, and every one is validated and run in tests/templates.test.ts.

export type Template = {
  key: string
  title: string
  description: string
  /** Where it fits ("Sales", "Finance"…) and what it shows off ("Dates", "Adjustable"). */
  tags: string[]
  sample: SampleName
  /** The sentence the AI would have been asked; shown in the editor's request box. */
  request: string
  definition: WorkflowDefinition
}

const REFUNDS_LAST_QUARTER: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { ordered_on: 'date', region: 'string', status: 'string', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'refunded' } },
    { id: 's2', type: 'filter', column: 'ordered_on', operator: 'gte', value: { relative: { unit: 'quarter', offset: -1, edge: 'start' } } },
    { id: 's3', type: 'filter', column: 'ordered_on', operator: 'lte', value: { relative: { unit: 'quarter', offset: -1, edge: 'end' } } },
    {
      id: 's4',
      type: 'aggregate',
      groupBy: ['region'],
      measures: [
        { op: 'sum', column: 'amount', as: 'refunded' },
        { op: 'count', as: 'refunds' },
      ],
    },
    { id: 's5', type: 'sort', by: [{ column: 'refunded', direction: 'desc' }] },
  ],
  output: { format: 'table' },
}

const LARGE_ORDERS_SINCE: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { order_id: 'string', ordered_on: 'date', region: 'string', sales_rep: 'string', status: 'string', amount: 'integer_inr' } },
  parameters: {
    min_amount: { type: 'integer', default: 50000, min: 0, max: 1000000000 },
    from_date: { type: 'date', default: '2026-01-01' },
  },
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    { id: 's2', type: 'filter', column: 'amount', operator: 'gte', value: { parameter: 'min_amount' } },
    { id: 's3', type: 'filter', column: 'ordered_on', operator: 'gte', value: { parameter: 'from_date' } },
    { id: 's4', type: 'sort', by: [{ column: 'amount', direction: 'desc' }] },
    {
      id: 's5',
      type: 'select',
      columns: [
        { column: 'order_id', as: 'Order' },
        { column: 'ordered_on', as: 'Ordered on' },
        { column: 'region', as: 'Region' },
        { column: 'sales_rep', as: 'Sales rep' },
        { column: 'amount', as: 'Amount' },
      ],
    },
  ],
  output: { format: 'table' },
}

const WEEKLY_ORDERS: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { ordered_on: 'date', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'date_part', column: 'ordered_on', part: 'week', as: 'week' },
    {
      id: 's2',
      type: 'aggregate',
      groupBy: ['week'],
      measures: [
        { op: 'count', as: 'orders' },
        { op: 'sum', column: 'amount', as: 'revenue' },
      ],
    },
    { id: 's3', type: 'sort', by: [{ column: 'week', direction: 'asc' }] },
  ],
  output: { format: 'table' },
}

const AVERAGE_DEAL_BY_REGION: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { region: 'string', status: 'string', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    {
      id: 's2',
      type: 'aggregate',
      groupBy: ['region'],
      measures: [
        { op: 'avg', column: 'amount', as: 'avg_deal' },
        { op: 'count', as: 'orders' },
        { op: 'max', column: 'amount', as: 'largest' },
      ],
    },
    { id: 's3', type: 'sort', by: [{ column: 'avg_deal', direction: 'desc' }] },
  ],
  output: { format: 'table' },
}

const CANCELLED_BY_REP: WorkflowDefinition = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { sales_rep: 'string', status: 'string', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'in', value: { list: ['cancelled', 'refunded'] } },
    {
      id: 's2',
      type: 'aggregate',
      groupBy: ['sales_rep'],
      measures: [
        { op: 'count', as: 'lost_orders' },
        { op: 'sum', column: 'amount', as: 'lost_amount' },
      ],
    },
    { id: 's3', type: 'sort', by: [{ column: 'lost_amount', direction: 'desc' }] },
  ],
  output: { format: 'table' },
}

export const TEMPLATES: Template[] = [
  {
    key: 'regional_exceptions',
    title: 'Regional revenue exceptions',
    description: 'Paid orders totalled by region, showing only regions below an adjustable threshold.',
    tags: ['Sales', 'Adjustable'],
    sample: 'sales_A.csv',
    request: REGIONAL_REVENUE_REQUEST,
    definition: REGIONAL_REVENUE_EXCEPTIONS,
  },
  {
    key: 'monthly_revenue',
    title: 'Monthly paid revenue, last six months',
    description: 'Paid orders since five months ago, totalled per month with the order count and the last order date. Counts from the day you run it.',
    tags: ['Sales', 'Dates'],
    sample: 'orders_dated.csv',
    request: 'Paid revenue per month for the last six months, with the number of orders and the date of the last order.',
    definition: MONTHLY_PAID_REVENUE,
  },
  {
    key: 'top_reps',
    title: 'Top sales reps by paid revenue',
    description: 'Ranks reps by paid revenue with their order count and average deal, and lets each run choose how many to show.',
    tags: ['Sales', 'Top N', 'Adjustable'],
    sample: 'sales_A.csv',
    request: 'Top 3 sales reps by paid revenue with their order count and average deal size; how many is adjustable.',
    definition: TOP_REPS_BY_REVENUE,
  },
  {
    key: 'large_orders_since',
    title: 'Large paid orders since a date',
    description: 'Paid orders at or above an adjustable amount, placed on or after a date you choose per run, largest first, with tidy headers.',
    tags: ['Sales', 'Dates', 'Adjustable'],
    sample: 'orders_dated.csv',
    request: 'Paid orders of at least 50000 placed on or after a configurable date (default 2026-01-01), largest first, showing order, date, region, rep and amount.',
    definition: LARGE_ORDERS_SINCE,
  },
  {
    key: 'refunds_last_quarter',
    title: 'Refunds last quarter by region',
    description: 'Refunded orders in the previous calendar quarter, totalled per region with the number of refunds.',
    tags: ['Finance', 'Dates'],
    sample: 'orders_dated.csv',
    request: 'Refunded amount and number of refunds per region for last quarter.',
    definition: REFUNDS_LAST_QUARTER,
  },
  {
    key: 'weekly_orders',
    title: 'Orders and revenue per week',
    description: 'Every order counted and totalled by ISO week, in calendar order.',
    tags: ['Operations', 'Dates'],
    sample: 'orders_dated.csv',
    request: 'Number of orders and total amount per week.',
    definition: WEEKLY_ORDERS,
  },
  {
    key: 'avg_deal_by_region',
    title: 'Average deal size by region',
    description: 'Paid orders per region: average deal (rounded to whole rupees), order count and the largest order.',
    tags: ['Sales'],
    sample: 'sales_A.csv',
    request: 'Average paid amount per region with the number of orders and the largest order, highest average first.',
    definition: AVERAGE_DEAL_BY_REGION,
  },
  {
    key: 'paid_by_rep',
    title: 'Paid revenue by sales rep',
    description: 'Keeps paid orders and totals the amount for each sales rep. A starting point for commission checks.',
    tags: ['Sales', 'Finance'],
    sample: 'sales_A.csv',
    request: 'Total paid amount for each sales rep.',
    definition: PAID_BY_SALES_REP,
  },
  {
    key: 'lost_orders_by_rep',
    title: 'Cancelled and refunded orders by rep',
    description: 'Orders that were cancelled or refunded, counted and totalled per sales rep, biggest loss first.',
    tags: ['Sales', 'Exceptions'],
    sample: 'sales_A.csv',
    request: 'Number and total amount of cancelled or refunded orders per sales rep, largest total first.',
    definition: CANCELLED_BY_REP,
  },
  {
    key: 'live_spend',
    title: 'Live spend by channel',
    description: 'Keeps live campaigns and totals spend per channel.',
    tags: ['Marketing'],
    sample: 'marketing_spend.csv',
    request: 'Total spend per channel for live campaigns.',
    definition: LIVE_SPEND_BY_CHANNEL,
  },
]

export const TEMPLATE_TAGS = [...new Set(TEMPLATES.flatMap((t) => t.tags))]
