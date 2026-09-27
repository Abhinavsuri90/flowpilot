import { describeRecipe, formatParameterValue, parameterUnits, type ParameterUnit } from './describe'
import { COLUMN_TYPE_LABEL, type Parameter, type WorkflowDefinition } from './schema'

// What changed between two versions of a recipe, in the same words the recipe
// page uses, so a reviewer can see a change without reading JSON.

export type Change = { kind: 'added' | 'removed' | 'changed'; text: string }

export type DefinitionDiff = {
  columns: Change[]
  parameters: Change[]
  steps: Change[]
  /** Every change, in reading order: columns, then parameters, then steps. */
  all: Array<Change & { group: 'column' | 'parameter' | 'step' }>
}

function defaultText(p: Parameter, unit: ParameterUnit | undefined): string {
  return formatParameterValue(p.default, unit)
}

function rangeText(p: Parameter, unit: ParameterUnit | undefined): string | null {
  return p.type === 'integer' ? `${formatParameterValue(p.min, unit)}–${formatParameterValue(p.max, unit)}` : null
}

export function diffDefinitions(prev: WorkflowDefinition, next: WorkflowDefinition): DefinitionDiff {
  const columns: Change[] = []
  for (const [name, type] of Object.entries(next.input.columns)) {
    const before = prev.input.columns[name]
    if (before === undefined) columns.push({ kind: 'added', text: `${name} (${COLUMN_TYPE_LABEL[type]})` })
    else if (before !== type) columns.push({ kind: 'changed', text: `${name}: ${COLUMN_TYPE_LABEL[before]} → ${COLUMN_TYPE_LABEL[type]}` })
  }
  for (const name of Object.keys(prev.input.columns)) if (!(name in next.input.columns)) columns.push({ kind: 'removed', text: name })

  const unitsBefore = parameterUnits(prev)
  const unitsAfter = parameterUnits(next)
  const parameters: Change[] = []
  for (const [name, p] of Object.entries(next.parameters)) {
    const before = prev.parameters[name]
    if (!before) {
      parameters.push({ kind: 'added', text: `${name} (default ${defaultText(p, unitsAfter[name])})` })
      continue
    }
    if (before.type !== p.type) {
      parameters.push({ kind: 'changed', text: `${name}: now ${p.type === 'integer' ? 'a number' : p.type === 'date' ? 'a date' : 'text'}, default ${defaultText(p, unitsAfter[name])}` })
      continue
    }
    const was = defaultText(before, unitsBefore[name])
    const now = defaultText(p, unitsAfter[name])
    if (was !== now) parameters.push({ kind: 'changed', text: `${name}: default ${was} → ${now}` })
    const rangeWas = rangeText(before, unitsBefore[name])
    const rangeNow = rangeText(p, unitsAfter[name])
    if (rangeWas !== rangeNow) parameters.push({ kind: 'changed', text: `${name}: allowed ${rangeWas} → ${rangeNow}` })
  }
  for (const name of Object.keys(prev.parameters)) if (!(name in next.parameters)) parameters.push({ kind: 'removed', text: name })

  // Parameters are named, not resolved, so a changed default is one change above rather than every step that uses it.
  const steps = diffLines(describeRecipe(prev, undefined, undefined, false), describeRecipe(next, undefined, undefined, false))
  const all: DefinitionDiff['all'] = [
    ...columns.map((c) => ({ ...c, group: 'column' as const })),
    ...parameters.map((c) => ({ ...c, group: 'parameter' as const })),
    ...steps.map((c) => ({ ...c, group: 'step' as const })),
  ]
  return { columns, parameters, steps, all }
}

/** Line diff by longest common subsequence: what was removed and what was added, in order. */
export function diffLines(before: string[], after: string[]): Change[] {
  const n = before.length
  const m = after.length
  // lcs[i][j] = length of the LCS of before[i..] and after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: Change[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      i++
      j++
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // Removals first, then additions, like a familiar diff.
      out.push({ kind: 'removed', text: before[i]! })
      i++
    } else {
      out.push({ kind: 'added', text: after[j]! })
      j++
    }
  }
  return out
}
