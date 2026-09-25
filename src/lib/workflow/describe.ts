import type { ColumnType, Operator, ParameterValues, Step, StepValue, WorkflowDefinition } from './schema'

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
}

export const OPERATOR_SYMBOL: Record<Operator, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
}

function formatScalar(value: string | number, type: ColumnType | undefined): string {
  if (typeof value === 'number') return type === 'string' ? String(value) : formatINR(value)
  return JSON.stringify(value)
}

/** Column types before each step, computed with the same rule the validator uses. */
function typesBeforeEachStep(def: Pick<WorkflowDefinition, 'input' | 'steps'>): Array<Map<string, ColumnType>> {
  let current = new Map(Object.entries(def.input?.columns ?? {}))
  const out: Array<Map<string, ColumnType>> = []
  for (const step of def.steps ?? []) {
    out.push(current)
    if (step?.type === 'group_sum') {
      current = new Map<string, ColumnType>([
        [step.groupBy, 'string'],
        [step.as, 'integer_inr'],
      ])
    }
  }
  return out
}

function valueText(
  value: StepValue,
  columnType: ColumnType | undefined,
  def: Pick<WorkflowDefinition, 'parameters'>,
  params?: ParameterValues,
  withName = true,
): string {
  if ('parameter' in value) {
    const name = value.parameter
    const resolved = params?.[name] ?? def.parameters?.[name]?.default
    if (resolved === undefined) return withName ? name : '?'
    const shown = formatScalar(resolved, columnType)
    return withName ? `${name} (${shown})` : shown
  }
  return formatScalar(value.literal, columnType)
}

/** "Keep rows where status equals "paid"", "Total amount by region as total". */
export function describeStep(
  step: Step,
  columnType: ColumnType | undefined,
  def: Pick<WorkflowDefinition, 'parameters'>,
  params?: ParameterValues,
): string {
  if (step.type === 'group_sum') return `Total ${step.valueColumn} by ${step.groupBy} as ${step.as}`
  return `Keep rows where ${step.column} ${OPERATOR_PHRASE[step.operator]} ${valueText(step.value, columnType, def, params)}`
}

/** Short form used in the summary line: `status = "paid"`, `grouped by region`, `total < ₹1,00,000`. */
export function stepChip(
  step: Step,
  columnType: ColumnType | undefined,
  def: Pick<WorkflowDefinition, 'parameters'>,
  params?: ParameterValues,
): string {
  if (step.type === 'group_sum') return `grouped by ${step.groupBy}`
  return `${step.column} ${OPERATOR_SYMBOL[step.operator]} ${valueText(step.value, columnType, def, params, false)}`
}

export function describeRecipe(def: WorkflowDefinition, params?: ParameterValues): string[] {
  const types = typesBeforeEachStep(def)
  return def.steps.map((step, i) =>
    describeStep(step, step.type === 'filter' ? types[i]?.get(step.column) : undefined, def, params),
  )
}

/** The deterministic summary line, e.g. `2 rows · status = "paid" · grouped by region · total < ₹1,00,000`. */
export function summarize(def: WorkflowDefinition, params: ParameterValues, rowCount: number): string {
  if (rowCount === 0) return 'No rows matched'
  const types = typesBeforeEachStep(def)
  const chips = def.steps.map((step, i) =>
    stepChip(step, step.type === 'filter' ? types[i]?.get(step.column) : undefined, def, params),
  )
  return [plural(rowCount, 'row'), ...chips].join(' · ')
}
