import type { core } from 'zod'
import type { ApiIssue } from '../types'
import { formatINR } from './describe'
import {
  AMOUNT_ONLY_OPERATORS,
  LIMITS,
  NAME_PATTERN,
  RESERVED_NAMES,
  STEP_TYPES,
  WorkflowDefinitionSchema,
  type Column,
  type ColumnType,
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
      if (type === 'string' || type === 'integer_inr') input.push({ name, type })
    }
  }

  // ----- parameters -----
  const paramTypes = new Map<string, 'integer' | 'string'>()
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
    }
  }

  // ----- steps, with schema tracking -----
  const stages: StageInfo[] = []
  const steps = Array.isArray(root.steps) ? root.steps : []
  const seenIds = new Set<string>()
  let current: Column[] = input.slice()
  const removedBy = new Map<string, { step: string; kept: [string, string] }>()
  let grouped = false

  steps.forEach((rawStep, i) => {
    const step = isRecord(rawStep) ? rawStep : {}
    const stepId = str(step.id)
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
      const found = current.find((c) => c.name === column)
      if (found) return found.type
      const removal = removedBy.get(column)
      if (removal) {
        push(
          field,
          `Column "${column}" is no longer available: ${removal.step} grouped the rows, which keeps only "${removal.kept[0]}" and "${removal.kept[1]}"`,
        )
      } else if (!grouped) {
        push(field, `Column "${column}" is not one of the declared input columns`)
      } else {
        push(field, `Column "${column}" is not available at this step. The rows now have only ${quoteList(current.map((c) => c.name))}`)
      }
      return undefined
    }

    if (step.type === 'filter') {
      const column = str(step.column)
      const columnType = column ? lookup(column, '.column') : undefined
      const operator = step.operator
      if (column && columnType === 'string' && typeof operator === 'string' && AMOUNT_ONLY_OPERATORS.has(operator as never)) {
        push('.operator', `"${operator}" compares amounts, but "${column}" is a text column. Use eq or neq for text`)
      }
      const value = step.value
      if (column && columnType && isRecord(value)) {
        const hasLiteral = 'literal' in value
        const hasParameter = 'parameter' in value
        if (hasParameter && !hasLiteral && typeof value.parameter === 'string') {
          const pType = paramTypes.get(value.parameter)
          if (!pType) {
            push('.value.parameter', `Parameter "${value.parameter}" is not declared. Add it under Parameters, or use a fixed value`)
          } else if (columnType === 'integer_inr' && pType !== 'integer') {
            push('.value.parameter', `Parameter "${value.parameter}" is text, but "${column}" is an amount column`)
          } else if (columnType === 'string' && pType !== 'string') {
            push('.value.parameter', `Parameter "${value.parameter}" is a number, but "${column}" is a text column`)
          }
        } else if (hasLiteral && !hasParameter) {
          const lit = value.literal
          if (columnType === 'integer_inr') {
            if (typeof lit !== 'number') push('.value.literal', `"${column}" is an amount column, so the value must be a whole number of rupees`)
            else if (!Number.isInteger(lit)) push('.value.literal', `Amounts are whole rupees; ${lit} has decimals`)
            else if (lit < 0) push('.value.literal', 'Amounts cannot be negative')
          } else if (typeof lit !== 'string') {
            push('.value.literal', `"${column}" is a text column, so the value must be text`)
          }
        }
      }
    } else if (step.type === 'group_sum') {
      const groupBy = str(step.groupBy)
      const valueColumn = str(step.valueColumn)
      const alias = str(step.as)
      if (groupBy) {
        const t = lookup(groupBy, '.groupBy')
        if (t === 'integer_inr') push('.groupBy', `"${groupBy}" is an amount column. Group by a text column`)
      }
      if (valueColumn) {
        const t = lookup(valueColumn, '.valueColumn')
        if (t === 'string') push('.valueColumn', `"${valueColumn}" is a text column. Sum an amount column`)
      }
      if (alias && groupBy && alias === groupBy) push('.as', `The new column can't also be named "${alias}", the group-by column`)
      if (alias && RESERVED_NAMES.has(alias)) push('.as', `"${alias}" is a reserved name`)
      if (groupBy) {
        const label = stepId ? `step ${stepId}` : `step ${i + 1}`
        const keep = alias ?? ''
        stage.removed = available.filter((c) => c.name !== groupBy && c.name !== keep).map((c) => c.name)
        for (const name of stage.removed) removedBy.set(name, { step: label, kept: [groupBy, alias ?? 'the total'] })
        removedBy.delete(groupBy)
        if (alias) removedBy.delete(alias)
        current = [{ name: groupBy, type: 'string' }, ...(alias && alias !== groupBy ? [{ name: alias, type: 'integer_inr' as const }] : [])]
        grouped = true
      }
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
        structural.push({ ...at, path: `steps[${i}].type`, message: 'Each step needs a type: filter or group_sum' })
        skipSteps.add(i)
      } else if (!(STEP_TYPES as readonly unknown[]).includes(step.type)) {
        structural.push({
          ...at,
          path: `steps[${i}].type`,
          message: `Unsupported step type "${String(step.type)}". Only filter and group_sum are allowed.`,
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
