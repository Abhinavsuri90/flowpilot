import type { core } from 'zod'
import type { ApiIssue } from '../types'
import { formatINR } from './describe'
import { isIsoDate } from '../dates'
import {
  AGGREGATE_OPS,
  COLUMN_TYPES,
  LIMITS,
  NAME_PATTERN,
  NUMERIC_ONLY_OPERATORS,
  RESERVED_NAMES,
  STEP_TYPES,
  TEXT_ONLY_OPERATORS,
  WorkflowDefinitionSchema,
  isDateType,
  isNumericType,
  type Column,
  type ColumnType,
  type Operator,
  type ParameterValues,
  type WorkflowDefinition,
} from './schema'

// Validation runs in the browser for live feedback and again on the server on
// every save, fork and run, including for definitions already in the database.

export type ValidationResult =
  | { ok: true; definition: WorkflowDefinition; issues: [] }
  | { ok: false; issues: ApiIssue[] }

export type StageInfo = {
  stepIndex: number
  stepId?: string
  type?: string
  /** Columns this step can use. */
  available: Column[]
  /** Columns after this step. */
  output: Column[]
  /** Columns this step removed (a group_sum keeps only its two columns). */
  removed: string[]
}

export type Analysis = {
  input: Column[]
  stages: StageInfo[]
  final: Column[]
  issues: ApiIssue[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const quoteList = (names: string[]) =>
  names.length === 0 ? 'no columns' : names.map((n) => `"${n}"`).join(names.length === 2 ? ' and ' : ', ')

/** Problems with a CSV column name declared in the input contract, or null. */
export function columnNameProblem(name: string): string | null {
  if (name.length === 0) return 'Column names cannot be empty'
  if (name.length > LIMITS.columnNameMax) return `Column names can be at most ${LIMITS.columnNameMax} characters`
  if (name.trim() !== name) return 'Column names cannot start or end with spaces'
  if (RESERVED_NAMES.has(name)) return `"${name}" is a reserved name`
  return null
}

function nameProblem(name: string): boolean {
  return !NAME_PATTERN.test(name) || RESERVED_NAMES.has(name)
}

/**
 * Tracks the available columns step by step and checks every reference.
 * Works on partial drafts too, so the editor can always offer the columns
 * available at each step.
 */
export function analyze(raw: unknown): Analysis {
  const issues: ApiIssue[] = []
  const root = isRecord(raw) ? raw : {}

  // ----- input contract -----
  const input: Column[] = []
  const inputObj = isRecord(root.input) ? root.input : undefined
  const columnsObj = inputObj && isRecord(inputObj.columns) ? inputObj.columns : undefined
  if (columnsObj) {
    const names = Object.keys(columnsObj)
    if (names.length === 0) issues.push({ path: 'input.columns', message: 'Declare at least one input column' })
    if (names.length > LIMITS.columns)
      issues.push({ path: 'input.columns', message: `A recipe can declare at most ${LIMITS.columns} input columns` })
    for (const name of names) {
      const problem = columnNameProblem(name)
      if (problem) issues.push({ path: `input.columns.${name}`, message: problem })
      const type = columnsObj[name]
      if ((COLUMN_TYPES as readonly unknown[]).includes(type)) input.push({ name, type: type as ColumnType })
    }
  }

  // ----- parameters -----
  const paramTypes = new Map<string, 'integer' | 'string' | 'date'>()
  const paramsObj = isRecord(root.parameters) ? root.parameters : {}
  const paramNames = Object.keys(paramsObj)
  if (paramNames.length > LIMITS.parameters)
    issues.push({ path: 'parameters', message: `A recipe can have at most ${LIMITS.parameters} parameters` })
  for (const name of paramNames) {
    const p = paramsObj[name]
    if (nameProblem(name)) {
      issues.push({
        path: `parameters.${name}`,
        message: `Parameter name "${name}" must be 1–64 lowercase letters, digits or _, starting with a letter or _`,
      })
    }
    if (!isRecord(p)) continue
    if (p.type === 'integer') {
      paramTypes.set(name, 'integer')
      const { min, max } = p
      const dflt = p.default
      if (Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(dflt)) {
        const lo = min as number
        const hi = max as number
        const d = dflt as number
        if (lo < 0) issues.push({ path: `parameters.${name}.min`, message: `${name}: min cannot be negative` })
        if (hi > LIMITS.integerParameterMax)
          issues.push({
            path: `parameters.${name}.max`,
            message: `${name}: max can be at most ${formatINR(LIMITS.integerParameterMax)}`,
          })
        if (lo > hi) issues.push({ path: `parameters.${name}.min`, message: `${name}: min is greater than max` })
        else if (d < lo || d > hi)
          issues.push({
            path: `parameters.${name}.default`,
            message: `${name}: the default ${formatINR(d)} must be between ${formatINR(lo)} and ${formatINR(hi)}`,
          })
      }
    } else if (p.type === 'string') {
      paramTypes.set(name, 'string')
    } else if (p.type === 'date') {
      paramTypes.set(name, 'date')
      if (!isIsoDate(p.default)) issues.push({ path: `parameters.${name}.default`, message: `${name}: the default must be a date like 2026-04-03` })
    }
  }

  // ----- steps, with schema tracking -----
  const stages: StageInfo[] = []
  const steps = Array.isArray(root.steps) ? root.steps : []
  const seenIds = new Set<string>()
  let current: Column[] = input.slice()
  // Why a column is no longer there (grouped away, not kept, renamed), for clear messages.
  const gone = new Map<string, string>()
  let reshaped = false

  steps.forEach((rawStep, i) => {
    const step = isRecord(rawStep) ? rawStep : {}
    const stepId = str(step.id)
    const label = stepId ? `step ${stepId}` : `step ${i + 1}`
    const at = { stepIndex: i, ...(stepId ? { stepId } : {}) }
    const push = (field: string, message: string) => issues.push({ ...at, path: `steps[${i}]${field}`, message })

    if (stepId) {
      if (seenIds.has(stepId)) push('.id', `Step id "${stepId}" is used more than once`)
      seenIds.add(stepId)
    }

    const available = current
    const stage: StageInfo = {
      stepIndex: i,
      ...(stepId ? { stepId } : {}),
      type: typeof step.type === 'string' ? step.type : undefined,
      available,
      output: current,
      removed: [],
    }

    const lookup = (column: string, field: string): ColumnType | undefined => {
      const found = available.find((c) => c.name === column)
      if (found) return found.type
      const why = gone.get(column)
      if (why) push(field, `Column "${column}" is no longer available: ${why}`)
      else if (!reshaped) push(field, `Column "${column}" is not one of the declared input columns`)
      else push(field, `Column "${column}" is not available at this step. The rows now have only ${quoteList(available.map((c) => c.name))}`)
      return undefined
    }
    /** Replaces the columns after this step, remembering why the others went away. */
    const reshape = (next: Column[], why: string, renamed: Array<[string, string]> = []) => {
      const nextNames = new Set(next.map((c) => c.name))
      stage.removed = available.filter((c) => !nextNames.has(c.name)).map((c) => c.name)
      for (const name of stage.removed) gone.set(name, why)
      for (const [from, to] of renamed) gone.set(from, `${label} renamed it to "${to}"`)
      for (const name of nextNames) gone.delete(name)
      current = next
      reshaped = true
    }
    const checkAlias = (alias: string | undefined, field: string, taken: Set<string>) => {
      if (!alias) return
      if (RESERVED_NAMES.has(alias)) push(field, `"${alias}" is a reserved name`)
      else if (taken.has(alias)) push(field, `Two columns would be called "${alias}". Choose another name`)
      taken.add(alias)
    }
    const paramCheck = (name: string, field: string, want: 'integer' | 'string' | 'date', what: string) => {
      const pType = paramTypes.get(name)
      if (!pType) push(field, `Parameter "${name}" is not declared. Add it under Parameters, or use a fixed value`)
      else if (pType !== want) push(field, `Parameter "${name}" is ${pType === 'integer' ? 'a number' : pType === 'date' ? 'a date' : 'text'}, but ${what}`)
    }

    if (step.type === 'filter') {
      const column = str(step.column)
      const columnType = column ? lookup(column, '.column') : undefined
      const operator = typeof step.operator === 'string' ? step.operator : undefined
      const numeric = isNumericType(columnType)
      const isDate = isDateType(columnType)
      if (column && columnType === 'string' && operator && NUMERIC_ONLY_OPERATORS.has(operator as Operator)) {
        push('.operator', `"${operator}" compares numbers, but "${column}" is a text column. Use equals, does not equal, contains or is one of`)
      }
      if (column && (numeric || isDate) && operator && TEXT_ONLY_OPERATORS.has(operator as Operator)) {
        push('.operator', `"${operator === 'in' ? 'is one of' : operator}" works on text, but "${column}" is a ${isDate ? 'date' : 'number'} column`)
      }
      const value = step.value
      if (column && columnType && isRecord(value)) {
        const hasLiteral = 'literal' in value
        const hasParameter = 'parameter' in value
        const hasList = 'list' in value
        const hasRelative = 'relative' in value
        if (operator === 'in') {
          if (!hasList || hasLiteral || hasParameter || hasRelative) push('.value', '"is one of" needs a list of values, like North, South')
        } else if (hasList) {
          push('.value', 'A list of values only works with "is one of"')
        } else if (hasRelative) {
          if (!isDate) push('.value', `A date relative to the run day only works on a date column, and "${column}" is ${numeric ? 'a number' : 'a text'} column`)
        } else if (hasParameter && !hasLiteral && typeof value.parameter === 'string') {
          const kind = columnType === 'integer_inr' ? 'an amount' : numeric ? 'a number' : isDate ? 'a date' : 'a text'
          paramCheck(value.parameter, '.value.parameter', numeric ? 'integer' : isDate ? 'date' : 'string', `"${column}" is ${kind} column`)
        } else if (hasLiteral && !hasParameter) {
          const lit = value.literal
          if (numeric) {
            const what = columnType === 'integer_inr' ? 'an amount column, so the value must be a whole number of rupees' : 'a number column, so the value must be a whole number'
            if (typeof lit !== 'number') push('.value.literal', `"${column}" is ${what}`)
            else if (!Number.isInteger(lit)) push('.value.literal', `Use whole numbers; ${lit} has decimals`)
            else if (lit < 0) push('.value.literal', 'Values cannot be negative')
          } else if (isDate) {
            if (!isIsoDate(lit)) push('.value.literal', `"${column}" is a date column, so the value must be a date like 2026-04-03`)
          } else if (typeof lit !== 'string') {
            push('.value.literal', `"${column}" is a text column, so the value must be text`)
          } else if (operator === 'contains' && lit.trim() === '') {
            push('.value.literal', 'Type the text to look for')
          }
        }
      }
    } else if (step.type === 'group_sum') {
      const groupBy = str(step.groupBy)
      const valueColumn = str(step.valueColumn)
      const alias = str(step.as)
      if (groupBy) {
        const t = lookup(groupBy, '.groupBy')
        if (t === 'date') push('.groupBy', `"${groupBy}" is a date column. Add a period (month, quarter or year) from it first, then group by that`)
        else if (t && t !== 'string') push('.groupBy', `"${groupBy}" is a number column. Group by a text column`)
      }
      if (valueColumn) {
        const t = lookup(valueColumn, '.valueColumn')
        if (t && t !== 'integer_inr') push('.valueColumn', `"${valueColumn}" is not an amount column. Sum an amount column (use a summary step for whole numbers)`)
      }
      if (alias && groupBy && alias === groupBy) push('.as', `The new column can't also be named "${alias}", the group-by column`)
      if (alias && RESERVED_NAMES.has(alias)) push('.as', `"${alias}" is a reserved name`)
      if (groupBy) {
        const next: Column[] = [{ name: groupBy, type: 'string' }, ...(alias && alias !== groupBy ? [{ name: alias, type: 'integer_inr' as const }] : [])]
        reshape(next, `${label} grouped the rows, which keeps only "${groupBy}" and "${alias ?? 'the total'}"`)
      }
    } else if (step.type === 'aggregate') {
      const groupBy = Array.isArray(step.groupBy) ? step.groupBy.filter((c): c is string => typeof c === 'string' && c !== '') : []
      const next: Column[] = []
      const taken = new Set<string>()
      groupBy.forEach((column, g) => {
        const t = lookup(column, `.groupBy[${g}]`)
        if (t === 'integer_inr') push(`.groupBy[${g}]`, `"${column}" is an amount column. Group by text or whole-number columns`)
        if (taken.has(column)) push(`.groupBy[${g}]`, `"${column}" is listed twice`)
        taken.add(column)
        if (t) next.push({ name: column, type: t })
      })
      const measures = Array.isArray(step.measures) ? step.measures : []
      measures.forEach((raw, m) => {
        const measure = isRecord(raw) ? raw : {}
        const op = typeof measure.op === 'string' ? measure.op : undefined
        const column = str(measure.column)
        const alias = str(measure.as)
        let type: ColumnType | undefined
        if (op === 'count') {
          if (column) push(`.measures[${m}].column`, 'A count counts rows; it takes no column')
          type = 'integer'
        } else if (op && (AGGREGATE_OPS as readonly string[]).includes(op)) {
          if (!column) push(`.measures[${m}].column`, `Choose the column to ${op === 'sum' ? 'total' : op === 'avg' ? 'average' : op === 'min' ? 'take the smallest of' : 'take the largest of'}`)
          else {
            const t = lookup(column, `.measures[${m}].column`)
            if (t === 'string') push(`.measures[${m}].column`, `"${column}" is a text column. Choose an amount or whole-number column`)
            else if (t === 'date' && op !== 'min' && op !== 'max')
              push(`.measures[${m}].column`, `"${column}" is a date column. Totals and averages need an amount or whole-number column; smallest and largest work on dates`)
            else type = t
          }
        }
        checkAlias(alias, `.measures[${m}].as`, taken)
        if (alias && type) next.push({ name: alias, type })
      })
      const kept = next.map((c) => `"${c.name}"`).join(', ') || 'its figures'
      reshape(next, `${label} summarized the rows, which keeps only ${kept}`)
    } else if (step.type === 'date_part') {
      const column = str(step.column)
      const alias = str(step.as)
      if (column) {
        const t = lookup(column, '.column')
        if (t && t !== 'date') push('.column', `"${column}" is ${t === 'string' ? 'a text' : 'a number'} column. A period needs a date column (set the column's type to date if it holds dates)`)
      }
      if (alias) {
        if (RESERVED_NAMES.has(alias)) push('.as', `"${alias}" is a reserved name`)
        else if (available.some((c) => c.name === alias)) push('.as', `There is already a column called "${alias}". Choose another name for the period`)
        else {
          current = [...available, { name: alias, type: 'string' }]
          gone.delete(alias)
        }
      }
    } else if (step.type === 'sort') {
      const keys = Array.isArray(step.by) ? step.by : []
      const seen = new Set<string>()
      keys.forEach((raw, k) => {
        const key = isRecord(raw) ? raw : {}
        const column = str(key.column)
        if (!column) return
        lookup(column, `.by[${k}].column`)
        if (seen.has(column)) push(`.by[${k}].column`, `"${column}" is already a sort key`)
        seen.add(column)
      })
    } else if (step.type === 'limit') {
      const rows = isRecord(step.rows) ? step.rows : undefined
      if (rows && typeof rows.parameter === 'string' && !('literal' in rows)) {
        paramCheck(rows.parameter, '.rows.parameter', 'integer', 'the number of rows to keep is a whole number')
        const p = paramsObj[rows.parameter]
        if (isRecord(p) && p.type === 'integer' && typeof p.min === 'number' && p.min < 1) {
          push('.rows.parameter', `Parameter "${rows.parameter}" needs a minimum of at least 1 to choose how many rows to keep`)
        }
      }
    } else if (step.type === 'select') {
      const cols = Array.isArray(step.columns) ? step.columns : []
      const next: Column[] = []
      const taken = new Set<string>()
      const sources = new Set<string>()
      const renamed: Array<[string, string]> = []
      cols.forEach((raw, c) => {
        const entry = isRecord(raw) ? raw : {}
        const column = str(entry.column)
        if (!column) return
        const t = lookup(column, `.columns[${c}].column`)
        if (sources.has(column)) push(`.columns[${c}].column`, `"${column}" is already kept`)
        sources.add(column)
        const alias = typeof entry.as === 'string' && entry.as !== '' ? entry.as : undefined
        if (alias) {
          const problem = columnNameProblem(alias)
          if (problem) push(`.columns[${c}].as`, problem)
          if (alias !== column) renamed.push([column, alias])
        }
        const name = alias ?? column
        if (taken.has(name)) push(`.columns[${c}]${alias ? '.as' : '.column'}`, `Two columns would be called "${name}". Choose another name`)
        taken.add(name)
        if (t) next.push({ name, type: t })
      })
      if (next.length) reshape(next, `${label} kept only ${quoteList(next.map((c) => c.name))}`, renamed)
    }

    stage.output = current
    stages.push(stage)
  })

  return { input, stages, final: current, issues }
}

// ----- Zod issue → plain-language issue -------------------------------------

function formatPath(path: PropertyKey[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out ? `.${String(seg)}` : String(seg)
  }
  return out
}

function fromZodIssue(issue: core.$ZodIssue, raw: Record<string, unknown>): ApiIssue {
  const path = formatPath(issue.path)
  const result: ApiIssue = { path, message: issue.message }
  if (issue.path[0] === 'steps' && typeof issue.path[1] === 'number') {
    result.stepIndex = issue.path[1]
    const step = Array.isArray(raw.steps) ? raw.steps[issue.path[1]] : undefined
    if (isRecord(step) && typeof step.id === 'string' && step.id) result.stepId = step.id
  }
  const field = [...issue.path].reverse().find((seg) => typeof seg === 'string') as string | undefined
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ')
    result.message = `Unknown field${issue.keys.length > 1 ? 's' : ''} ${keys}${path ? ` in ${path}` : ''}`
  } else if (issue.code === 'invalid_type' && issue.input === undefined && field) {
    result.message = `"${field}" is required`
  }
  return result
}

function issueOrder(a: ApiIssue, b: ApiIssue): number {
  const ai = a.stepIndex ?? -1
  const bi = b.stepIndex ?? -1
  return ai - bi || a.path.localeCompare(b.path)
}

/**
 * Full structural + semantic validation. Returns the typed definition only if
 * every rule passes; otherwise every problem found, pinned to its step.
 */
export function validateDefinition(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return { ok: false, issues: [{ path: '', message: 'A recipe must be a JSON object' }] }

  const structural: ApiIssue[] = []
  const skipSteps = new Set<number>()

  // Step types are checked before Zod so an unknown operation gets one clear message.
  if (Array.isArray(raw.steps)) {
    raw.steps.forEach((step, i) => {
      if (!isRecord(step)) {
        structural.push({ stepIndex: i, path: `steps[${i}]`, message: 'Each step must be an object' })
        skipSteps.add(i)
        return
      }
      const at = { stepIndex: i, ...(typeof step.id === 'string' && step.id ? { stepId: step.id } : {}) }
      if (step.type === undefined) {
        structural.push({ ...at, path: `steps[${i}].type`, message: 'Each step needs a type: filter, group_sum, aggregate, sort, limit, select or date_part' })
        skipSteps.add(i)
      } else if (!(STEP_TYPES as readonly unknown[]).includes(step.type)) {
        structural.push({
          ...at,
          path: `steps[${i}].type`,
          message: `Unsupported step type "${String(step.type)}". Only filter, group_sum, aggregate, sort, limit, select and date_part are allowed.`,
        })
        skipSteps.add(i)
      }
    })
  }

  const parsed = WorkflowDefinitionSchema.safeParse(raw, { reportInput: true })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'steps' && typeof issue.path[1] === 'number' && skipSteps.has(issue.path[1])) continue
      structural.push(fromZodIssue(issue, raw))
    }
  }

  const semantic = analyze(raw).issues
  // Prefer the more specific semantic message when both flag the same field.
  const semanticPaths = new Set(semantic.map((i) => i.path))
  const merged = [...structural.filter((i) => !semanticPaths.has(i.path)), ...semantic]
  const seen = new Set<string>()
  const issues = merged.filter((i) => {
    const key = `${i.path}\u0000${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (issues.length || !parsed.success) return { ok: false, issues: issues.sort(issueOrder) }
  return { ok: true, definition: parsed.data as WorkflowDefinition, issues: [] }
}

/** The declared input contract as an ordered column list. */
export function inputColumns(def: Pick<WorkflowDefinition, 'input'>): Column[] {
  return Object.entries(def.input.columns).map(([name, type]) => ({ name, type }))
}

// ----- Run parameters --------------------------------------------------------

export type ParameterResult = { ok: true; values: ParameterValues } | { ok: false; issues: ApiIssue[] }

/**
 * Checks run-time values against the declared parameters. Unknown names are
 * rejected, missing values take their defaults, and nothing here ever changes
 * the recipe itself.
 */
export function resolveParameters(def: WorkflowDefinition, provided: unknown): ParameterResult {
  const given = provided === undefined || provided === null ? {} : provided
  if (!isRecord(given)) {
    return { ok: false, issues: [{ path: 'parameters', message: 'Parameters must be an object of name → value' }] }
  }
  const issues: ApiIssue[] = []
  const declared = Object.keys(def.parameters)
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(def.parameters, key)) {
      issues.push({
        path: `parameters.${key}`,
        message: `Unknown parameter "${key}". This recipe has ${declared.length ? declared.map((n) => `"${n}"`).join(', ') : 'no parameters'}`,
      })
    }
  }

  const values: ParameterValues = {}
  for (const [name, param] of Object.entries(def.parameters)) {
    const value = given[name]
    if (value === undefined || value === null || value === '') {
      values[name] = param.default
      continue
    }
    if (param.type === 'integer') {
      let n: number | null = null
      if (typeof value === 'number' && Number.isInteger(value)) n = value
      else if (typeof value === 'string' && /^\s*\d{1,15}\s*$/.test(value)) n = Number(value.trim())
      const range = `between ${formatINR(param.min)} and ${formatINR(param.max)}`
      if (n === null) {
        issues.push({ path: `parameters.${name}`, message: `${name} must be a whole number ${range}` })
      } else if (n < param.min || n > param.max) {
        issues.push({ path: `parameters.${name}`, message: `${name} must be ${range}; ${formatINR(n)} is outside that range` })
      } else {
        values[name] = n
      }
    } else if (param.type === 'date') {
      if (isIsoDate(value)) values[name] = value
      else issues.push({ path: `parameters.${name}`, message: `${name} must be a date like 2026-04-03` })
    } else if (typeof value !== 'string') {
      issues.push({ path: `parameters.${name}`, message: `${name} must be text` })
    } else if (value.length > LIMITS.textMax) {
      issues.push({ path: `parameters.${name}`, message: `${name} can be at most ${LIMITS.textMax} characters` })
    } else {
      values[name] = value
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, values }
}
