import { AGGREGATE_OPS, COLUMN_TYPES, DATE_PARTS, DATE_UNITS, OPERATORS, type AggregateOp, type ColumnType, type DatePart, type DateUnit, type Operator, type StepType, type WorkflowDefinition } from './schema'
import { todayIso } from '../dates'

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
export type DraftParam = { key: string; name: string; type: 'integer' | 'string' | 'date'; default: string; min: string; max: string }
export type DraftMeasure = { key: string; op: AggregateOp; column: string; as: string }
export type DraftSortKey = { key: string; column: string; direction: 'asc' | 'desc' }
export type DraftPick = { key: string; column: string; as: string }

/** One form for every step type; each type reads only its own fields. */
export type DraftStep = {
  key: string
  id: string
  type: StepType
  // filter (and limit: valueKind / literal / parameter hold the number of rows; date_part: column + as)
  column: string
  operator: Operator
  valueKind: 'literal' | 'parameter' | 'relative'
  literal: string
  parameter: string
  /** "is one of" values, comma-separated as typed. */
  list: string
  /** A date relative to the run day (filters on date columns). */
  relativeUnit: DateUnit
  relativeOffset: string
  relativeEdge: 'start' | 'end'
  // date_part
  part: DatePart
  // group_sum
  groupBy: string
  valueColumn: string
  as: string
  // aggregate
  groupColumns: string[]
  measures: DraftMeasure[]
  // sort
  sortKeys: DraftSortKey[]
  // select
  picks: DraftPick[]
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

export const newMeasure = (op: AggregateOp = 'sum', as = 'total'): DraftMeasure => ({ key: draftKey(), op, column: '', as })
export const newSortKey = (): DraftSortKey => ({ key: draftKey(), column: '', direction: 'desc' })
export const newPick = (column = '', as = ''): DraftPick => ({ key: draftKey(), column, as })

export function newStep(type: StepType, existingIds: string[]): DraftStep {
  let n = existingIds.length + 1
  while (existingIds.includes(`s${n}`)) n++
  return {
    key: draftKey(),
    id: `s${n}`,
    type,
    column: '',
    operator: 'eq',
    valueKind: 'literal',
    literal: type === 'limit' ? '10' : '',
    parameter: '',
    list: '',
    relativeUnit: 'month',
    relativeOffset: '-1',
    relativeEdge: 'start',
    part: 'month',
    groupBy: '',
    valueColumn: '',
    as: type === 'group_sum' ? 'total' : type === 'date_part' ? 'month' : '',
    groupColumns: type === 'aggregate' ? [''] : [],
    measures: type === 'aggregate' ? [newMeasure()] : [],
    sortKeys: type === 'sort' ? [newSortKey()] : [],
    picks: [],
  }
}

export function newParam(existingNames: string[], type: 'integer' | 'string' | 'date' = 'integer', dflt = '', base?: string, min = '0'): DraftParam {
  const stem = base ?? (type === 'integer' ? 'threshold' : type === 'date' ? 'from_date' : 'value')
  let name = stem
  let n = 2
  while (existingNames.includes(name)) name = `${stem}_${n++}`
  return { key: draftKey(), name, type, default: dflt || (type === 'integer' ? '0' : type === 'date' ? todayIso() : ''), min, max: '1000000000' }
}

const asInt = (s: string): number | string => (/^\s*\d{1,15}\s*$/.test(s) ? Number(s.trim()) : s)
const asSignedInt = (s: string): number | string => (/^\s*-?\d{1,9}\s*$/.test(s) ? Number(s.trim()) : s)

/** "North, South ,  West" → ["North", "South", "West"]. */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Column types before each step, following the same shape rules as the validator (on partial drafts too). */
export function typesBefore(draft: Pick<Draft, 'columns' | 'steps'>): Array<Map<string, ColumnType>> {
  let current = new Map(draft.columns.filter((c) => c.include).map((c) => [c.name, c.type] as const))
  return draft.steps.map((step) => {
    const before = current
    if (step.type === 'group_sum' && step.groupBy) {
      current = new Map<string, ColumnType>([[step.groupBy, 'string']])
      if (step.as && step.as !== step.groupBy) current.set(step.as, 'integer_inr')
    } else if (step.type === 'aggregate') {
      const next = new Map<string, ColumnType>()
      for (const column of step.groupColumns) if (column && before.has(column)) next.set(column, before.get(column)!)
      for (const m of step.measures) {
        if (!m.as) continue
        if (m.op === 'count') next.set(m.as, 'integer')
        else if (before.has(m.column)) next.set(m.as, before.get(m.column)!)
      }
      current = next
    } else if (step.type === 'select' && step.picks.some((p) => p.column)) {
      const next = new Map<string, ColumnType>()
      for (const p of step.picks) if (p.column && before.has(p.column)) next.set(p.as.trim() || p.column, before.get(p.column)!)
      current = next
    } else if (step.type === 'date_part' && step.as.trim()) {
      current = new Map(before).set(step.as.trim(), 'string')
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
        : p.type === 'date'
          ? { type: 'date', default: p.default.trim() }
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
      switch (s.type) {
        case 'group_sum':
          return { id: s.id, type: 'group_sum', groupBy: s.groupBy, valueColumn: s.valueColumn, as: s.as }
        case 'aggregate':
          return {
            id: s.id,
            type: 'aggregate',
            groupBy: s.groupColumns.filter(Boolean),
            measures: s.measures.map((m) => (m.op === 'count' ? { op: 'count', as: m.as } : { op: m.op, column: m.column, as: m.as })),
          }
        case 'sort':
          return { id: s.id, type: 'sort', by: s.sortKeys.map((k) => ({ column: k.column, direction: k.direction })) }
        case 'limit':
          return { id: s.id, type: 'limit', rows: s.valueKind === 'parameter' ? { parameter: s.parameter } : { literal: asInt(s.literal) } }
        case 'select':
          return {
            id: s.id,
            type: 'select',
            columns: s.picks.map((p) => (p.as.trim() && p.as.trim() !== p.column ? { column: p.column, as: p.as.trim() } : { column: p.column })),
          }
        case 'date_part':
          return { id: s.id, type: 'date_part', column: s.column, part: s.part, as: s.as.trim() }
        case 'filter': {
          const columnType = types[i]?.get(s.column)
          if (s.operator === 'in') return { id: s.id, type: 'filter', column: s.column, operator: 'in', value: { list: splitList(s.list) } }
          const numeric = columnType === 'integer_inr' || columnType === 'integer'
          const literal = numeric ? asInt(s.literal) : s.literal.trim()
          const value =
            s.valueKind === 'parameter'
              ? { parameter: s.parameter }
              : s.valueKind === 'relative'
                ? { relative: { unit: s.relativeUnit, offset: asSignedInt(s.relativeOffset), edge: s.relativeEdge } }
                : { literal }
          return { id: s.id, type: 'filter', column: s.column, operator: s.operator, value }
        }
      }
    }),
    output: { format: 'table' },
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/**
 * Loads any step-shaped value (a saved definition, or a model draft that failed
 * validation) into the editor without throwing, so its problems can be pinned
 * to the right step cards and fixed by hand.
 */
function draftStepFrom(raw: unknown, i: number): DraftStep {
  const obj = isObj(raw) ? raw : {}
  const id = text(obj.id) || `s${i + 1}`
  switch (obj.type) {
    case 'group_sum':
      return { ...newStep('group_sum', []), id, groupBy: text(obj.groupBy), valueColumn: text(obj.valueColumn), as: text(obj.as) }
    case 'aggregate': {
      const groupBy = Array.isArray(obj.groupBy) ? obj.groupBy.map(text) : []
      const measures = (Array.isArray(obj.measures) ? obj.measures : []).map((m) => {
        const mm = isObj(m) ? m : {}
        const op = AGGREGATE_OPS.find((o) => o === mm.op) ?? 'sum'
        return { key: draftKey(), op, column: text(mm.column), as: text(mm.as) }
      })
      return { ...newStep('aggregate', []), id, groupColumns: groupBy, measures }
    }
    case 'sort': {
      const by = (Array.isArray(obj.by) ? obj.by : []).map((k) => {
        const kk = isObj(k) ? k : {}
        return { key: draftKey(), column: text(kk.column), direction: kk.direction === 'asc' ? ('asc' as const) : ('desc' as const) }
      })
      return { ...newStep('sort', []), id, sortKeys: by }
    }
    case 'limit': {
      const rows = isObj(obj.rows) ? obj.rows : {}
      return {
        ...newStep('limit', []),
        id,
        valueKind: 'parameter' in rows ? 'parameter' : 'literal',
        literal: 'literal' in rows ? text(rows.literal) : '',
        parameter: text(rows.parameter),
      }
    }
    case 'select': {
      const picks = (Array.isArray(obj.columns) ? obj.columns : []).map((c) => {
        const cc = isObj(c) ? c : {}
        return newPick(text(cc.column), text(cc.as))
      })
      return { ...newStep('select', []), id, picks }
    }
    case 'date_part':
      return {
        ...newStep('date_part', []),
        id,
        column: text(obj.column),
        part: DATE_PARTS.find((p) => p === obj.part) ?? 'month',
        as: text(obj.as),
      }
    default: {
      const value = isObj(obj.value) ? obj.value : {}
      const relative = isObj(value.relative) ? value.relative : null
      const operator = OPERATORS.find((o) => o === obj.operator) ?? 'eq'
      return {
        ...newStep('filter', []),
        id,
        column: text(obj.column),
        operator,
        valueKind: 'parameter' in value ? 'parameter' : relative ? 'relative' : 'literal',
        literal: text(value.literal),
        parameter: text(value.parameter),
        list: Array.isArray(value.list) ? value.list.map(text).join(', ') : '',
        relativeUnit: DATE_UNITS.find((u) => u === relative?.unit) ?? 'month',
        relativeOffset: relative ? text(relative.offset) || '0' : '-1',
        relativeEdge: relative?.edge === 'end' ? 'end' : 'start',
      }
    }
  }
}

/** Loads a saved (or generated) definition into the editor. */
export function definitionToDraft(def: WorkflowDefinition): Pick<Draft, 'columns' | 'parameters' | 'steps'> {
  return draftFromUnknown(def)
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

export function draftFromUnknown(raw: unknown): Pick<Draft, 'columns' | 'parameters' | 'steps'> {
  const root = isObj(raw) ? raw : {}
  const input = isObj(root.input) ? root.input : {}
  const columns = isObj(input.columns) ? input.columns : {}
  const params = isObj(root.parameters) ? root.parameters : {}
  const steps = Array.isArray(root.steps) ? root.steps : []
  return {
    columns: Object.entries(columns).map(([name, type]) => ({
      name,
      type: (COLUMN_TYPES as readonly unknown[]).includes(type) ? (type as ColumnType) : 'string',
      include: true,
      samples: [],
      blanks: 0,
    })),
    parameters: Object.entries(params).map(([name, p]) => {
      const obj = isObj(p) ? p : {}
      const type = obj.type === 'string' ? 'string' : obj.type === 'date' ? 'date' : 'integer'
      return {
        key: draftKey(),
        name,
        type,
        default: text(obj.default),
        min: type === 'integer' ? text(obj.min) || '0' : '0',
        max: type === 'integer' ? text(obj.max) || '1000000000' : '1000000000',
      } satisfies DraftParam
    }),
    steps: steps.map(draftStepFrom),
  }
}
