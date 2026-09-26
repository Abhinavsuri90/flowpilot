import { columnsThrough } from './columns'
import { isNumericType, type AggregateOp, type Column, type ColumnType, type LimitStep, type Measure, type Operator, type ParameterValues, type Step, type StepType, type StepValue, type WorkflowDefinition } from './schema'

// Everything here is computed, never generated: the same recipe and parameters
// always produce the same words.

/** Indian digit grouping without relying on the runtime's ICU data: 100000 → "1,00,000". */
export function groupIndian(n: number): string {
  const negative = n < 0
  const digits = Math.trunc(Math.abs(n)).toString()
  if (digits.length <= 3) return (negative ? '-' : '') + digits
  const last3 = digits.slice(-3)
  let rest = digits.slice(0, -3)
  const groups: string[] = []
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  if (rest) groups.unshift(rest)
  return (negative ? '-' : '') + groups.join(',') + ',' + last3
}

/** Whole-rupee amounts in en-IN style: 100000 → "₹1,00,000". */
export function formatINR(n: number): string {
  return (n < 0 ? '-₹' : '₹') + groupIndian(Math.abs(n))
}

export function formatCount(n: number): string {
  return groupIndian(n)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}

export const OPERATOR_PHRASE: Record<Operator, string> = {
  eq: 'equals',
  neq: 'does not equal',
  lt: 'is less than',
  lte: 'is at most',
  gt: 'is more than',
  gte: 'is at least',
  contains: 'contains',
  in: 'is one of',
}

export const OPERATOR_SYMBOL: Record<Operator, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  contains: 'contains',
  in: 'in',
}

/** Names of the step types in the editor and the step lists. */
export const STEP_LABEL: Record<StepType, string> = {
  filter: 'Filter rows',
  group_sum: 'Group & sum',
  aggregate: 'Summarize',
  sort: 'Sort',
  limit: 'Keep first N',
  select: 'Choose columns',
}

export const AGGREGATE_PHRASE: Record<AggregateOp, string> = {
  count: 'number of rows',
  sum: 'total',
  avg: 'average',
  min: 'smallest',
  max: 'largest',
}

/** A value as people read it: amounts in rupees, whole numbers grouped, text quoted. */
export function formatValue(value: string | number, type: ColumnType | undefined): string {
  if (typeof value === 'number') return type === 'integer_inr' ? formatINR(value) : type === 'string' ? String(value) : groupIndian(value)
  return JSON.stringify(value)
}

function valueText(
  value: StepValue,
  columnType: ColumnType | undefined,
  def: Pick<WorkflowDefinition, 'parameters'>,
  params?: ParameterValues,
  withName = true,
): string {
  if ('list' in value) return value.list.map((v) => JSON.stringify(v)).join(', ')
  if ('parameter' in value) {
    const name = value.parameter
    const resolved = params?.[name] ?? def.parameters?.[name]?.default
    if (resolved === undefined) return withName ? name : '?'
    const shown = formatValue(resolved, columnType)
    return withName ? `${name} (${shown})` : shown
  }
  return formatValue(value.literal, columnType)
}

function measureText(measure: Measure): string {
  if (measure.op === 'count') return `number of rows as ${measure.as}`
  const rounded = measure.op === 'avg' ? ' (rounded)' : ''
  return `${AGGREGATE_PHRASE[measure.op]} ${measure.column}${rounded} as ${measure.as}`
}

function limitText(step: LimitStep, def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues, withName = true): string {
  if ('literal' in step.rows) return formatCount(step.rows.literal)
  const name = step.rows.parameter
  const resolved = params?.[name] ?? def.parameters?.[name]?.default
  if (resolved === undefined) return withName ? name : '?'
  return withName ? `${name} (${formatCount(Number(resolved))})` : formatCount(Number(resolved))
}

const listNames = (names: string[]) => names.join(', ')

/**
 * One step in plain words, e.g. "Keep rows where status equals "paid"",
 * "Total amount by region as total", "Sort by revenue (highest first)".
 * `available` are the columns before the step (for value formatting).
 */
export function describeStep(step: Step, available: Column[], def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues): string {
  switch (step.type) {
    case 'filter': {
      const type = available.find((c) => c.name === step.column)?.type
      const suffix = step.operator === 'contains' ? ' (ignoring capitals)' : ''
      return `Keep rows where ${step.column} ${OPERATOR_PHRASE[step.operator]} ${valueText(step.value, type, def, params)}${suffix}`
    }
    case 'group_sum':
      return `Total ${step.valueColumn} by ${step.groupBy} as ${step.as}`
    case 'aggregate':
      return step.groupBy.length
        ? `Group by ${listNames(step.groupBy)}: ${step.measures.map(measureText).join(', ')}`
        : `Summarize all rows: ${step.measures.map(measureText).join(', ')}`
    case 'sort':
      return `Sort by ${step.by
        .map((k) => {
          const numeric = isNumericType(available.find((c) => c.name === k.column)?.type)
          const order = numeric ? (k.direction === 'desc' ? 'highest first' : 'lowest first') : k.direction === 'desc' ? 'Z to A' : 'A to Z'
          return `${k.column} (${order})`
        })
        .join(', then ')}`
    case 'limit':
      return `Keep the first ${limitText(step, def, params)} rows`
    case 'select':
      return `Keep columns ${step.columns.map((c) => (c.as && c.as !== c.column ? `${c.column} as "${c.as}"` : c.column)).join(', ')}`
  }
}

/**
 * Short form for the summary line: `status = "paid"`, `grouped by region`,
 * `sorted by total ↓`, `first 3`. Column choices don't change which rows you
 * get, so they have no chip.
 */
export function stepChip(step: Step, available: Column[], def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues): string | null {
  switch (step.type) {
    case 'filter': {
      const type = available.find((c) => c.name === step.column)?.type
      if (step.operator === 'in') return `${step.column} in (${'list' in step.value ? step.value.list.join(', ') : ''})`
      return `${step.column} ${OPERATOR_SYMBOL[step.operator]} ${valueText(step.value, type, def, params, false)}`
    }
    case 'group_sum':
      return `grouped by ${step.groupBy}`
    case 'aggregate':
      return step.groupBy.length ? `grouped by ${listNames(step.groupBy)}` : 'summarized'
    case 'sort':
      return `sorted by ${step.by.map((k) => `${k.column} ${k.direction === 'desc' ? '↓' : '↑'}`).join(', ')}`
    case 'limit':
      return `first ${limitText(step, def, params, false)}`
    case 'select':
      return null
  }
}

export function describeRecipe(def: WorkflowDefinition, params?: ParameterValues): string[] {
  const { before } = columnsThrough(def)
  return def.steps.map((step, i) => describeStep(step, before[i] ?? [], def, params))
}

/** The deterministic summary line, e.g. `2 rows · status = "paid" · grouped by region · total < ₹1,00,000`. */
export function summarize(def: WorkflowDefinition, params: ParameterValues, rowCount: number): string {
  if (rowCount === 0) return 'No rows matched'
  const { before } = columnsThrough(def)
  const chips = def.steps.map((step, i) => stepChip(step, before[i] ?? [], def, params)).filter((c): c is string => c !== null)
  return [plural(rowCount, 'row'), ...chips].join(' · ')
}

/**
 * Whether each integer parameter is an amount (it filters an amount column) or
 * a plain number (it counts rows, or filters a whole-number column). Amount is
 * the default, which is what every recipe before whole numbers meant.
 */
export function parameterUnits(def: Pick<WorkflowDefinition, 'input' | 'steps' | 'parameters'>): Record<string, 'inr' | 'number'> {
  const units: Record<string, 'inr' | 'number'> = {}
  const { before } = columnsThrough(def)
  def.steps.forEach((step, i) => {
    if (step.type === 'limit' && 'parameter' in step.rows) units[step.rows.parameter] ??= 'number'
    if (step.type === 'filter' && 'parameter' in step.value) {
      const type = before[i]?.find((c) => c.name === step.column)?.type
      if (type === 'integer_inr') units[step.value.parameter] = 'inr'
      else if (type === 'integer') units[step.value.parameter] ??= 'number'
    }
  })
  for (const [name, p] of Object.entries(def.parameters)) if (p.type === 'integer') units[name] ??= 'inr'
  return units
}

/** A parameter value as people read it: ₹50,000, 10 or "paid". */
export function formatParameterValue(value: string | number, unit: 'inr' | 'number' | undefined): string {
  if (typeof value === 'string') return `“${value}”`
  return unit === 'number' ? formatCount(value) : formatINR(value)
}

/** "threshold ₹50,000, top_n 3": the values a run used, formatted for its recipe. */
export function describeParameters(def: WorkflowDefinition, values: ParameterValues): string {
  const units = parameterUnits(def)
  return Object.entries(values)
    .map(([name, value]) => `${name} ${formatParameterValue(value, units[name])}`)
    .join(', ')
}
