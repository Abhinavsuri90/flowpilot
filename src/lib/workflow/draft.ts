import type { ColumnType, Operator, WorkflowDefinition } from './schema'

// The editor edits a loose, form-friendly draft. It converts to a definition on
// every change, and the same validator as the server decides whether it's valid.

export type DraftColumn = {
  name: string
  type: ColumnType
  include: boolean
  samples: string[]
  blanks: number
  /** Distinct values from the sample file (browser only; never part of the recipe or sent to the model). */
  values?: string[]
}
export type DraftParam = { key: string; name: string; type: 'integer' | 'string'; default: string; min: string; max: string }
export type DraftStep = {
  key: string
  id: string
  type: 'filter' | 'group_sum'
  column: string
  operator: Operator
  valueKind: 'literal' | 'parameter'
  literal: string
  parameter: string
  groupBy: string
  valueColumn: string
  as: string
}

/** Where the current steps came from; AI drafts carry a review badge until saved. */
export type DraftOrigin = 'blank' | 'saved' | 'ai'

export type Draft = {
  title: string
  description: string
  request: string
  columns: DraftColumn[]
  parameters: DraftParam[]
  steps: DraftStep[]
  origin: DraftOrigin
}

let counter = 0
export const draftKey = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`

export function emptyDraft(): Draft {
  return { title: '', description: '', request: '', columns: [], parameters: [], steps: [], origin: 'blank' }
}

export function newStep(type: 'filter' | 'group_sum', existingIds: string[]): DraftStep {
  let n = existingIds.length + 1
  while (existingIds.includes(`s${n}`)) n++
  return {
    key: draftKey(),
    id: `s${n}`,
    type,
    column: '',
    operator: 'eq',
    valueKind: 'literal',
    literal: '',
    parameter: '',
    groupBy: '',
    valueColumn: '',
    as: type === 'group_sum' ? 'total' : '',
  }
}

export function newParam(existingNames: string[], type: 'integer' | 'string' = 'integer', dflt = ''): DraftParam {
  const base = type === 'integer' ? 'threshold' : 'value'
  let name = base
  let n = 2
  while (existingNames.includes(name)) name = `${base}_${n++}`
  return { key: draftKey(), name, type, default: dflt || (type === 'integer' ? '0' : ''), min: '0', max: '1000000000' }
}

const asInt = (s: string): number | string => (/^\s*\d{1,15}\s*$/.test(s) ? Number(s.trim()) : s)

/** Column types before each step, following the same schema rule as the validator. */
function typesBefore(draft: Pick<Draft, 'columns' | 'steps'>): Array<Map<string, ColumnType>> {
  let current = new Map(draft.columns.filter((c) => c.include).map((c) => [c.name, c.type] as const))
  return draft.steps.map((step) => {
    const before = current
    if (step.type === 'group_sum' && step.groupBy) {
      current = new Map<string, ColumnType>([[step.groupBy, 'string']])
      if (step.as && step.as !== step.groupBy) current.set(step.as, 'integer_inr')
    }
    return before
  })
}

/** Converts the draft to a (possibly invalid) definition for validation and saving. */
export function draftToDefinition(draft: Draft): unknown {
  const types = typesBefore(draft)
  const parameters: Record<string, unknown> = {}
  for (const p of draft.parameters) {
    parameters[p.name] =
      p.type === 'integer'
        ? { type: 'integer', default: asInt(p.default), min: asInt(p.min), max: asInt(p.max) }
        : { type: 'string', default: p.default }
  }
  return {
    schemaVersion: 1,
    input: {
      format: 'csv',
      columns: Object.fromEntries(draft.columns.filter((c) => c.include).map((c) => [c.name, c.type])),
    },
    parameters,
    steps: draft.steps.map((s, i) => {
      if (s.type === 'group_sum') return { id: s.id, type: 'group_sum', groupBy: s.groupBy, valueColumn: s.valueColumn, as: s.as }
      const columnType = types[i]?.get(s.column)
      const literal = columnType === 'integer_inr' ? asInt(s.literal) : s.literal.trim()
      return {
        id: s.id,
        type: 'filter',
        column: s.column,
        operator: s.operator,
        value: s.valueKind === 'parameter' ? { parameter: s.parameter } : { literal },
      }
    }),
    output: { format: 'table' },
  }
}

/** Loads a saved (or generated) definition into the editor. */
export function definitionToDraft(def: WorkflowDefinition): Pick<Draft, 'columns' | 'parameters' | 'steps'> {
  return {
    columns: Object.entries(def.input.columns).map(([name, type]) => ({ name, type, include: true, samples: [], blanks: 0 })),
    parameters: Object.entries(def.parameters).map(([name, p]) => ({
      key: draftKey(),
      name,
      type: p.type,
      default: String(p.default),
      min: p.type === 'integer' ? String(p.min) : '0',
      max: p.type === 'integer' ? String(p.max) : '1000000000',
    })),
    steps: def.steps.map((s) =>
      s.type === 'group_sum'
        ? { ...newStep('group_sum', []), id: s.id, groupBy: s.groupBy, valueColumn: s.valueColumn, as: s.as }
        : {
            ...newStep('filter', []),
            id: s.id,
            column: s.column,
            operator: s.operator,
            valueKind: 'parameter' in s.value ? 'parameter' : 'literal',
            literal: 'literal' in s.value ? String(s.value.literal) : '',
            parameter: 'parameter' in s.value ? s.value.parameter : '',
          },
    ),
  }
}

/**
 * Merges generated or imported steps with the columns already declared: keeps
 * sample values for columns the author declared and adds any new ones.
 */
export function mergeColumns(existing: DraftColumn[], incoming: DraftColumn[]): DraftColumn[] {
  const byName = new Map(existing.map((c) => [c.name, c]))
  const incomingNames = new Set(incoming.map((c) => c.name))
  const merged: DraftColumn[] = incoming.map((c) => {
    const known = byName.get(c.name)
    return { ...c, samples: known?.samples ?? c.samples, blanks: known?.blanks ?? c.blanks, values: known?.values ?? c.values }
  })
  // Declared-but-unused sample columns stay listed, unchecked.
  for (const c of existing) if (!incomingNames.has(c.name)) merged.push({ ...c, include: false })
  return merged
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/**
 * Loads any definition-shaped value (for example a model draft that failed
 * validation) into the editor without throwing, so its problems can be pinned
 * to the right step cards and fixed by hand.
 */
export function draftFromUnknown(raw: unknown): Pick<Draft, 'columns' | 'parameters' | 'steps'> {
  const root = isObj(raw) ? raw : {}
  const input = isObj(root.input) ? root.input : {}
  const columns = isObj(input.columns) ? input.columns : {}
  const params = isObj(root.parameters) ? root.parameters : {}
  const steps = Array.isArray(root.steps) ? root.steps : []
  return {
    columns: Object.entries(columns).map(([name, type]) => ({
      name,
      type: type === 'integer_inr' ? 'integer_inr' : 'string',
      include: true,
      samples: [],
      blanks: 0,
    })),
    parameters: Object.entries(params).map(([name, p]) => {
      const obj = isObj(p) ? p : {}
      const type = obj.type === 'string' ? 'string' : 'integer'
      return {
        key: draftKey(),
        name,
        type,
        default: text(obj.default),
        min: type === 'integer' ? text(obj.min) || '0' : '0',
        max: type === 'integer' ? text(obj.max) || '1000000000' : '1000000000',
      } satisfies DraftParam
    }),
    steps: steps.map((s, i): DraftStep => {
      const obj = isObj(s) ? s : {}
      const id = text(obj.id) || `s${i + 1}`
      if (obj.type === 'group_sum') {
        return { ...newStep('group_sum', []), id, groupBy: text(obj.groupBy), valueColumn: text(obj.valueColumn), as: text(obj.as) }
      }
      const value = isObj(obj.value) ? obj.value : {}
      const operator = (['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const).find((o) => o === obj.operator) ?? 'eq'
      return {
        ...newStep('filter', []),
        id,
        column: text(obj.column),
        operator,
        valueKind: 'parameter' in value ? 'parameter' : 'literal',
        literal: text(value.literal),
        parameter: text(value.parameter),
      }
    }),
  }
}
