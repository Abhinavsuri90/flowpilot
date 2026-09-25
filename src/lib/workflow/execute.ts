import { inputColumns } from './validate'
import {
  LIMITS,
  type Column,
  type FilterStep,
  type GroupSumStep,
  type Operator,
  type ParameterValues,
  type Row,
  type StepLogEntry,
  type StepValue,
  type WorkflowDefinition,
} from './schema'

// The deterministic engine. Two allowlisted operations, implemented as plain
// functions; values are literals or declared parameters and are never evaluated.
// Callers validate the definition and resolve parameters first.

export type ExecutionErrorCode = 'TIMEOUT' | 'EXECUTION_ERROR'

export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode
  constructor(code: ExecutionErrorCode, message: string) {
    super(message)
    this.name = 'ExecutionError'
    this.code = code
  }
}

export type ExecutionResult = { columns: Column[]; rows: Row[]; stepLog: StepLogEntry[] }

export type ExecuteOptions = {
  /** Defaults to LIMITS.deadlineMs (30 s). */
  deadlineMs?: number
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number
}

const CHECK_EVERY = 1024

/** Orders strings by Unicode code point (not UTF-16 unit, not locale), so output never depends on the machine. */
export function compareCodePoints(a: string, b: string): number {
  const ai = a[Symbol.iterator]()
  const bi = b[Symbol.iterator]()
  for (;;) {
    const x = ai.next()
    const y = bi.next()
    if (x.done) return y.done ? 0 : -1
    if (y.done) return 1
    const cx = x.value.codePointAt(0)!
    const cy = y.value.codePointAt(0)!
    if (cx !== cy) return cx - cy
  }
}

function resolveValue(value: StepValue, params: ParameterValues, stepId: string): string | number {
  if ('literal' in value) return value.literal
  const resolved = params[value.parameter]
  if (resolved === undefined) throw new ExecutionError('EXECUTION_ERROR', `Step ${stepId}: parameter "${value.parameter}" has no value`)
  return resolved
}

function comparator(operator: Operator, target: string | number): (cell: string | number | undefined) => boolean {
  switch (operator) {
    case 'eq':
      return (cell) => cell === target
    case 'neq':
      return (cell) => cell !== target
    case 'lt':
      return (cell) => typeof cell === 'number' && cell < (target as number)
    case 'lte':
      return (cell) => typeof cell === 'number' && cell <= (target as number)
    case 'gt':
      return (cell) => typeof cell === 'number' && cell > (target as number)
    case 'gte':
      return (cell) => typeof cell === 'number' && cell >= (target as number)
  }
}

function runFilter(step: FilterStep, rows: Row[], columns: Column[], params: ParameterValues, check: () => void): Row[] {
  const column = columns.find((c) => c.name === step.column)
  if (!column) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: column "${step.column}" is not available`)
  const target = resolveValue(step.value, params, step.id)
  if (column.type === 'integer_inr' && typeof target !== 'number')
    throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is an amount but the value is text`)
  if (column.type === 'string' && typeof target !== 'string')
    throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is text but the value is a number`)

  const test = comparator(step.operator, target)
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    if (test(row[step.column])) out.push(row)
  }
  return out
}

function runGroupSum(step: GroupSumStep, rows: Row[], check: () => void): { rows: Row[]; columns: Column[] } {
  const sums = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    const key = row[step.groupBy]
    const amount = row[step.valueColumn]
    if (typeof key !== 'string') throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.groupBy}" is not text`)
    if (typeof amount !== 'number' || !Number.isInteger(amount))
      throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.valueColumn}" is not a whole-rupee amount`)
    const next = (sums.get(key) ?? 0) + amount
    if (!Number.isSafeInteger(next)) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: the total is too large to add up exactly`)
    sums.set(key, next)
  }
  const keys = [...sums.keys()].sort(compareCodePoints)
  return {
    rows: keys.map((key) => ({ [step.groupBy]: key, [step.as]: sums.get(key)! })),
    columns: [
      { name: step.groupBy, type: 'string' },
      { name: step.as, type: 'integer_inr' },
    ],
  }
}

const round2 = (ms: number) => Math.round(ms * 100) / 100

/** Runs a validated recipe over parsed rows. Pure: no I/O, no model, same input → same output. */
export function execute(
  def: WorkflowDefinition,
  input: Row[],
  params: ParameterValues,
  options: ExecuteOptions = {},
): ExecutionResult {
  const now = options.now ?? (() => performance.now())
  const budget = options.deadlineMs ?? LIMITS.deadlineMs
  const deadline = now() + budget
  const check = () => {
    if (now() > deadline) {
      throw new ExecutionError('TIMEOUT', `The run took longer than ${Math.round(budget / 1000)} seconds and was stopped.`)
    }
  }

  let columns = inputColumns(def)
  let rows = input
  const stepLog: StepLogEntry[] = []

  for (const step of def.steps) {
    check()
    const started = now()
    const rowsIn = rows.length
    if (step.type === 'filter') {
      rows = runFilter(step, rows, columns, params, check)
    } else if (step.type === 'group_sum') {
      ;({ rows, columns } = runGroupSum(step, rows, check))
    } else {
      throw new ExecutionError('EXECUTION_ERROR', `Unsupported step type "${(step as { type: string }).type}"`)
    }
    stepLog.push({ stepId: step.id, type: step.type, rowsIn, rowsOut: rows.length, ms: round2(now() - started) })
  }
  check()

  // Only the columns that survive the pipeline, in their tracked order.
  const names = columns.map((c) => c.name)
  const projected = rows.map((row) => Object.fromEntries(names.map((n) => [n, row[n]!])) as Row)
  return { columns, rows: projected, stepLog }
}
