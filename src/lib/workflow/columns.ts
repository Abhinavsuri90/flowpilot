import type { Column, ColumnType, Measure, Step, WorkflowDefinition } from './schema'

// One rule for which columns exist after each step, shared by the engine, the
// validator (for valid steps), the descriptions, the editor and the AI adapter,
// so they can never disagree about a recipe's shape.

function typeOf(columns: Column[], name: string): ColumnType {
  return columns.find((c) => c.name === name)?.type ?? 'string'
}

/** The type of a summary figure: counts are whole numbers; the rest keep their column's type. */
export function measureType(measure: Measure, before: Column[]): ColumnType {
  return measure.op === 'count' ? 'integer' : typeOf(before, measure.column)
}

/** Columns after `step`, given the columns before it. Assumes the step is valid. */
export function columnsAfter(step: Step, before: Column[]): Column[] {
  switch (step.type) {
    case 'filter':
    case 'sort':
    case 'limit':
      return before
    case 'group_sum':
      return [
        { name: step.groupBy, type: 'string' },
        { name: step.as, type: 'integer_inr' },
      ]
    case 'aggregate':
      return [
        ...step.groupBy.map((name) => ({ name, type: typeOf(before, name) })),
        ...step.measures.map((m) => ({ name: m.as, type: measureType(m, before) })),
      ]
    case 'select':
      return step.columns.map((c) => ({ name: c.as ?? c.column, type: typeOf(before, c.column) }))
  }
}

/** Columns available to each step (index i = before step i), plus the final columns. */
export function columnsThrough(def: Pick<WorkflowDefinition, 'input' | 'steps'>): { before: Column[][]; final: Column[] } {
  let current: Column[] = Object.entries(def.input.columns).map(([name, type]) => ({ name, type }))
  const before: Column[][] = []
  for (const step of def.steps) {
    before.push(current)
    current = columnsAfter(step, current)
  }
  return { before, final: current }
}
