import { columnsThrough } from './columns'
import { describeRelative, formatDate, relativeDate } from '../dates'
import { isDateType, isNumericType, type AggregateOp, type Column, type ColumnType, type DatePart, type LimitStep, type Measure, type Operator, type ParameterValues, type Step, type StepType, type StepValue, type WorkflowDefinition } from './schema'

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

/** The same operators read differently on dates. */
export const DATE_OPERATOR_PHRASE: Record<Operator, string> = {
  eq: 'is on',
  neq: 'is not on',
  lt: 'is before',
  lte: 'is on or before',
  gt: 'is after',
  gte: 'is on or after',
  contains: 'contains',
  in: 'is one of',
}

export const PART_PHRASE: Record<DatePart, string> = { year: 'year', quarter: 'quarter', month: 'month', week: 'week' }

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
  date_part: 'Period from a date',
}

export const AGGREGATE_PHRASE: Record<AggregateOp, string> = {
  count: 'number of rows',
  sum: 'total',
  avg: 'average',
  min: 'smallest',
  max: 'largest',
}

/** A value as people read it: amounts in rupees, whole numbers grouped, dates as "3 Apr 2026", text quoted. */
export function formatValue(value: string | number, type: ColumnType | undefined): string {
  if (typeof value === 'number') return type === 'integer_inr' ? formatINR(value) : type === 'string' ? String(value) : groupIndian(value)
  if (type === 'date') return formatDate(value)
  return JSON.stringify(value)
}

function valueText(
  value: StepValue,
  columnType: ColumnType | undefined,
  def: Pick<WorkflowDefinition, 'parameters'>,
  params?: ParameterValues,
  withName = true,
  asOf?: string,
  showDefaults = true,
): string {
  if ('list' in value) return value.list.map((v) => JSON.stringify(v)).join(', ')
  if ('relative' in value) {
    const phrase = describeRelative(value.relative)
    return asOf ? `${phrase} (${formatDate(relativeDate(asOf, value.relative))})` : phrase
  }
  if ('parameter' in value) {
    const name = value.parameter
    if (!showDefaults && !params) return name
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

function limitText(step: LimitStep, def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues, withName = true, showDefaults = true): string {
  if ('literal' in step.rows) return formatCount(step.rows.literal)
  const name = step.rows.parameter
  if (!showDefaults && !params) return name
  const resolved = params?.[name] ?? def.parameters?.[name]?.default
  if (resolved === undefined) return withName ? name : '?'
  return withName ? `${name} (${formatCount(Number(resolved))})` : formatCount(Number(resolved))
}

const listNames = (names: string[]) => names.join(', ')

/**
 * One step in plain words, e.g. "Keep rows where status equals "paid"",
 * "Total amount by region as total", "Sort by revenue (highest first)".
 * `available` are the columns before the step (for value formatting); `asOf`
 * (the run day) turns relative dates into the dates they meant; `showDefaults`
 * false names parameters without their defaults (the version diff uses it, so a
 * changed default reads as one change, not as every step that uses it).
 */
export function describeStep(step: Step, available: Column[], def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues, asOf?: string, showDefaults = true): string {
  switch (step.type) {
    case 'filter': {
      const type = available.find((c) => c.name === step.column)?.type
      const suffix = step.operator === 'contains' ? ' (ignoring capitals)' : ''
      const phrase = isDateType(type) ? DATE_OPERATOR_PHRASE[step.operator] : OPERATOR_PHRASE[step.operator]
      return `Keep rows where ${step.column} ${phrase} ${valueText(step.value, type, def, params, true, asOf, showDefaults)}${suffix}`
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
          const type = available.find((c) => c.name === k.column)?.type
          const desc = k.direction === 'desc'
          const order = isNumericType(type) ? (desc ? 'highest first' : 'lowest first') : isDateType(type) ? (desc ? 'newest first' : 'oldest first') : desc ? 'Z to A' : 'A to Z'
          return `${k.column} (${order})`
        })
        .join(', then ')}`
    case 'limit':
      return `Keep the first ${limitText(step, def, params, true, showDefaults)} rows`
    case 'select':
      return `Keep columns ${step.columns.map((c) => (c.as && c.as !== c.column ? `${c.column} as "${c.as}"` : c.column)).join(', ')}`
    case 'date_part':
      return `Add ${step.as}: the ${PART_PHRASE[step.part]} of ${step.column}`
  }
}

/**
 * Short form for the summary line: `status = "paid"`, `grouped by region`,
 * `sorted by total ↓`, `first 3`. Column choices don't change which rows you
 * get, so they have no chip.
 */
export function stepChip(step: Step, available: Column[], def: Pick<WorkflowDefinition, 'parameters'>, params?: ParameterValues, asOf?: string): string | null {
  switch (step.type) {
    case 'filter': {
      const type = available.find((c) => c.name === step.column)?.type
      if (step.operator === 'in') return `${step.column} in (${'list' in step.value ? step.value.list.join(', ') : ''})`
      return `${step.column} ${OPERATOR_SYMBOL[step.operator]} ${valueText(step.value, type, def, params, false, asOf)}`
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
    case 'date_part':
      return null
  }
}

export function describeRecipe(def: WorkflowDefinition, params?: ParameterValues, asOf?: string, showDefaults = true): string[] {
  const { before } = columnsThrough(def)
  return def.steps.map((step, i) => describeStep(step, before[i] ?? [], def, params, asOf, showDefaults))
}

/** The deterministic summary line, e.g. `2 rows · status = "paid" · grouped by region · total < ₹1,00,000`. */
export function summarize(def: WorkflowDefinition, params: ParameterValues, rowCount: number, asOf?: string): string {
  if (rowCount === 0) return 'No rows matched'
  const { before } = columnsThrough(def)
  const chips = def.steps.map((step, i) => stepChip(step, before[i] ?? [], def, params, asOf)).filter((c): c is string => c !== null)
  return [plural(rowCount, 'row'), ...chips].join(' · ')
}

/**
 * Whether each integer parameter is an amount (it filters an amount column) or
 * a plain number (it counts rows, or filters a whole-number column). Amount is
 * the default, which is what every recipe before whole numbers meant.
 */
export type ParameterUnit = 'inr' | 'number' | 'date'

export function parameterUnits(def: Pick<WorkflowDefinition, 'input' | 'steps' | 'parameters'>): Record<string, ParameterUnit> {
  const units: Record<string, ParameterUnit> = {}
  const { before } = columnsThrough(def)
  def.steps.forEach((step, i) => {
    if (step.type === 'limit' && 'parameter' in step.rows) units[step.rows.parameter] ??= 'number'
    if (step.type === 'filter' && 'parameter' in step.value) {
      const type = before[i]?.find((c) => c.name === step.column)?.type
      if (type === 'integer_inr') units[step.value.parameter] = 'inr'
      else if (type === 'integer') units[step.value.parameter] ??= 'number'
    }
  })
  for (const [name, p] of Object.entries(def.parameters)) {
    if (p.type === 'integer') units[name] ??= 'inr'
    else if (p.type === 'date') units[name] = 'date'
  }
  return units
}

/** A parameter value as people read it: ₹50,000, 10, 3 Apr 2026 or "paid". */
export function formatParameterValue(value: string | number, unit: ParameterUnit | undefined): string {
  if (typeof value === 'string') return unit === 'date' ? formatDate(value) : `“${value}”`
  return unit === 'number' ? formatCount(value) : formatINR(value)
}

/** The run day a recipe with relative dates counted from, stored with the run's parameters. */
export const AS_OF_KEY = 'as_of'

/** "threshold ₹50,000, top_n 3, as of 27 Sep 2026": the values a run used, formatted for its recipe. */
export function describeParameters(def: WorkflowDefinition, values: ParameterValues): string {
  const units = parameterUnits(def)
  return Object.entries(values)
    .map(([name, value]) => (name === AS_OF_KEY ? `as of ${formatDate(String(value))}` : `${name} ${formatParameterValue(value, units[name])}`))
    .join(', ')
}
