import { inputColumns } from './validate'
import { columnsAfter } from './columns'
import { datePart, relativeDate, todayIso } from '../dates'
import {
  LIMITS,
  type AggregateStep,
  type Column,
  type DatePartStep,
  type FilterStep,
  type GroupSumStep,
  type LimitStep,
  type Operator,
  type ParameterValues,
  type Row,
  type SelectStep,
  type SortStep,
  type StepLogEntry,
  type StepValue,
  type WorkflowDefinition,
} from './schema'

// The deterministic engine. Allowlisted operations, implemented as plain
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
  /** The day relative dates count from (YYYY-MM-DD); defaults to today. */
  asOf?: string
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

/** Numbers numerically, text by code point; the same rule everywhere a recipe orders rows. */
function compareCells(a: string | number | undefined, b: string | number | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return compareCodePoints(String(a ?? ''), String(b ?? ''))
}

function resolveScalar(value: StepValue, params: ParameterValues, stepId: string, asOf: string): string | number {
  if ('literal' in value) return value.literal
  if ('parameter' in value) {
    const resolved = params[value.parameter]
    if (resolved === undefined) throw new ExecutionError('EXECUTION_ERROR', `Step ${stepId}: parameter "${value.parameter}" has no value`)
    return resolved
  }
  if ('relative' in value) return relativeDate(asOf, value.relative)
  throw new ExecutionError('EXECUTION_ERROR', `Step ${stepId}: a list is only allowed with "is one of"`)
}

/** Dates are ISO text, so text order is calendar order. */
function dateComparator(operator: Exclude<Operator, 'in'>, target: string): (cell: string | number | undefined) => boolean {
  switch (operator) {
    case 'eq':
      return (cell) => cell === target
    case 'neq':
      return (cell) => cell !== target
    case 'lt':
      return (cell) => typeof cell === 'string' && cell < target
    case 'lte':
      return (cell) => typeof cell === 'string' && cell <= target
    case 'gt':
      return (cell) => typeof cell === 'string' && cell > target
    case 'gte':
      return (cell) => typeof cell === 'string' && cell >= target
    case 'contains':
      return () => false
  }
}

function comparator(operator: Exclude<Operator, 'in'>, target: string | number): (cell: string | number | undefined) => boolean {
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
    case 'contains': {
      // Ignoring capitals (Unicode default case mapping, the same on every machine).
      const needle = String(target).toLowerCase()
      return (cell) => typeof cell === 'string' && cell.toLowerCase().includes(needle)
    }
  }
}

function runFilter(step: FilterStep, rows: Row[], columns: Column[], params: ParameterValues, asOf: string, check: () => void): Row[] {
  const column = columns.find((c) => c.name === step.column)
  if (!column) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: column "${step.column}" is not available`)

  let test: (cell: string | number | undefined) => boolean
  if (step.operator === 'in') {
    if (!('list' in step.value)) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "is one of" needs a list of values`)
    const allowed = new Set(step.value.list)
    test = (cell) => typeof cell === 'string' && allowed.has(cell)
  } else if (column.type === 'date') {
    const target = resolveScalar(step.value, params, step.id, asOf)
    if (typeof target !== 'string') throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is a date column but the value is a number`)
    test = dateComparator(step.operator, target)
  } else {
    const target = resolveScalar(step.value, params, step.id, asOf)
    if ('relative' in step.value) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: a relative date only works on a date column`)
    const numeric = column.type !== 'string'
    if (numeric && typeof target !== 'number')
      throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is a number column but the value is text`)
    if (!numeric && typeof target !== 'string')
      throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is text but the value is a number`)
    test = comparator(step.operator, target)
  }

  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    if (test(row[step.column])) out.push(row)
  }
  return out
}

function runGroupSum(step: GroupSumStep, rows: Row[], check: () => void): Row[] {
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
  return keys.map((key) => ({ [step.groupBy]: key, [step.as]: sums.get(key)! }))
}

/** Average of whole numbers, rounded to the nearest whole number with halves up, computed exactly. */
export function roundedAverage(sum: number, count: number): number {
  return Number((2n * BigInt(sum) + BigInt(count)) / (2n * BigInt(count)))
}

type Figure = { sum: number; min: number | string | undefined; max: number | string | undefined; n: number }
type Accumulator = { key: Array<string | number>; count: number; figures: Figure[] }

function runAggregate(step: AggregateStep, rows: Row[], check: () => void): Row[] {
  const groups = new Map<string, Accumulator>()
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    const key = step.groupBy.map((column) => row[column] ?? '')
    const id = JSON.stringify(key)
    let acc = groups.get(id)
    if (!acc) {
      acc = { key, count: 0, figures: step.measures.map(() => ({ sum: 0, min: undefined, max: undefined, n: 0 })) }
      groups.set(id, acc)
    }
    acc.count++
    step.measures.forEach((measure, m) => {
      if (measure.op === 'count') return
      const value = row[measure.column]
      const figure = acc!.figures[m]!
      if (typeof value === 'string') {
        // Dates: only the earliest and latest make sense.
        if (measure.op !== 'min' && measure.op !== 'max')
          throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${measure.column}" is not a number`)
      } else {
        if (typeof value !== 'number' || !Number.isInteger(value))
          throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${measure.column}" is not a whole number`)
        figure.sum += value
        if (!Number.isSafeInteger(figure.sum)) throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: the total is too large to add up exactly`)
      }
      if (figure.min === undefined || compareCells(value, figure.min) < 0) figure.min = value
      if (figure.max === undefined || compareCells(value, figure.max) > 0) figure.max = value
      figure.n++
    })
  }

  const ordered = [...groups.values()].sort((a, b) => {
    for (let k = 0; k < a.key.length; k++) {
      const c = compareCells(a.key[k], b.key[k])
      if (c !== 0) return c
    }
    return 0
  })
  return ordered.map((acc) => {
    const out: Row = {}
    step.groupBy.forEach((column, k) => {
      out[column] = acc.key[k]!
    })
    step.measures.forEach((measure, m) => {
      const figure = acc.figures[m]!
      out[measure.as] =
        measure.op === 'count'
          ? acc.count
          : measure.op === 'sum'
            ? figure.sum
            : measure.op === 'avg'
              ? roundedAverage(figure.sum, figure.n)
              : measure.op === 'min'
                ? (figure.min ?? 0)
                : (figure.max ?? 0)
    })
    return out
  })
}

function runSort(step: SortStep, rows: Row[]): Row[] {
  // Array.prototype.sort is stable, so ties keep their earlier order.
  return rows.slice().sort((a, b) => {
    for (const key of step.by) {
      const c = compareCells(a[key.column], b[key.column])
      if (c !== 0) return key.direction === 'desc' ? -c : c
    }
    return 0
  })
}

function runLimit(step: LimitStep, rows: Row[], params: ParameterValues): Row[] {
  const n = 'literal' in step.rows ? step.rows.literal : params[step.rows.parameter]
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: the number of rows to keep must be a whole number`)
  return rows.slice(0, n)
}

function runDatePart(step: DatePartStep, rows: Row[], check: () => void): Row[] {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    const value = row[step.column]
    if (typeof value !== 'string') throw new ExecutionError('EXECUTION_ERROR', `Step ${step.id}: "${step.column}" is not a date`)
    out.push({ ...row, [step.as]: datePart(value, step.part) })
  }
  return out
}

function runSelect(step: SelectStep, rows: Row[], check: () => void): Row[] {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i % CHECK_EVERY === CHECK_EVERY - 1) check()
    const row = rows[i]!
    const next: Row = {}
    for (const c of step.columns) next[c.as ?? c.column] = row[c.column]!
    out.push(next)
  }
  return out
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
  const asOf = options.asOf ?? todayIso()
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
    switch (step.type) {
      case 'filter':
        rows = runFilter(step, rows, columns, params, asOf, check)
        break
      case 'group_sum':
        rows = runGroupSum(step, rows, check)
        break
      case 'aggregate':
        rows = runAggregate(step, rows, check)
        break
      case 'sort':
        rows = runSort(step, rows)
        break
      case 'limit':
        rows = runLimit(step, rows, params)
        break
      case 'select':
        rows = runSelect(step, rows, check)
        break
      case 'date_part':
        rows = runDatePart(step, rows, check)
        break
      default:
        throw new ExecutionError('EXECUTION_ERROR', `Unsupported step type "${(step as { type: string }).type}"`)
    }
    columns = columnsAfter(step, columns)
    stepLog.push({ stepId: step.id, type: step.type, rowsIn, rowsOut: rows.length, ms: round2(now() - started) })
  }
  check()

  // Only the columns that survive the pipeline, in their tracked order.
  const names = columns.map((c) => c.name)
  const projected = rows.map((row) => Object.fromEntries(names.map((n) => [n, row[n]!])) as Row)
  return { columns, rows: projected, stepLog }
}
