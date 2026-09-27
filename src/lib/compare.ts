import { isNumericType, type Column, type Row } from './workflow/schema'

// What changed between two results of the same recipe, row by row: the report
// people rerun every week, read as "West fell from ₹70,000 to ₹20,000; North is
// new; South dropped out". Rows are matched by their labels (text and date
// columns: region, month, sales rep, order id) and numbers are compared exactly.

export type ResultSnapshot = { columns: Column[]; rows: Row[] }

export type RowChange = {
  /** The row's labels, in column order ([] for a single overall row). */
  key: Array<string | number>
  before: Row
  after: Row
  /** after − before, for each figure that changed. */
  deltas: Record<string, number>
}

export type Comparison =
  | { comparable: false; reason: 'columns' | 'no-labels' | 'duplicate-labels'; detail: string }
  | {
      comparable: true
      /** Columns that identify a row. */
      labels: string[]
      /** Columns compared as numbers. */
      figures: string[]
      changed: RowChange[]
      /** Rows only in the newer result, in its order. */
      added: Row[]
      /** Rows only in the older result, in its order. */
      removed: Row[]
      unchanged: number
    }

const signature = (columns: Column[]) => columns.map((c) => `${c.name}:${c.type}`)

function index(rows: Row[], labels: string[]): { byKey: Map<string, Row>; duplicate: Row | null } {
  const byKey = new Map<string, Row>()
  for (const row of rows) {
    const key = JSON.stringify(labels.map((l) => row[l] ?? null))
    if (byKey.has(key)) return { byKey, duplicate: row }
    byKey.set(key, row)
  }
  return { byKey, duplicate: null }
}

/** Compares an older result with a newer one of the same shape. */
export function compareResults(before: ResultSnapshot, after: ResultSnapshot): Comparison {
  const older = new Set(signature(before.columns))
  const newer = new Set(signature(after.columns))
  const gained = signature(after.columns).filter((s) => !older.has(s))
  const lost = signature(before.columns).filter((s) => !newer.has(s))
  if (gained.length || lost.length) {
    const name = (s: string) => s.split(':')[0]
    const parts = [gained.length ? `now has ${gained.map(name).join(', ')}` : '', lost.length ? `no longer has ${lost.map(name).join(', ')}` : '']
    return {
      comparable: false,
      reason: 'columns',
      detail: `The columns changed between these runs (the result ${parts.filter(Boolean).join(' and ')}), so rows can’t be matched.`,
    }
  }

  const labels = after.columns.filter((c) => !isNumericType(c.type)).map((c) => c.name)
  const figures = after.columns.filter((c) => isNumericType(c.type)).map((c) => c.name)
  // A result without labels can still be compared when it is a single overall row.
  if (labels.length === 0 && (before.rows.length > 1 || after.rows.length > 1)) {
    return { comparable: false, reason: 'no-labels', detail: 'These rows have no text or date column to tell them apart, so they can’t be matched.' }
  }

  const old = index(before.rows, labels)
  const now = index(after.rows, labels)
  const duplicate = old.duplicate ?? now.duplicate
  if (duplicate) {
    const shown = labels.map((l) => `${l} “${duplicate[l]}”`).join(', ')
    return {
      comparable: false,
      reason: 'duplicate-labels',
      detail: `More than one row has ${shown}, so rows can’t be matched one to one.`,
    }
  }

  const changed: RowChange[] = []
  const added: Row[] = []
  let unchanged = 0
  for (const [key, row] of now.byKey) {
    const previous = old.byKey.get(key)
    if (!previous) {
      added.push(row)
      continue
    }
    const deltas: Record<string, number> = {}
    for (const figure of figures) {
      const a = Number(previous[figure] ?? 0)
      const b = Number(row[figure] ?? 0)
      if (a !== b) deltas[figure] = b - a
    }
    if (Object.keys(deltas).length) changed.push({ key: labels.map((l) => row[l]!), before: previous, after: row, deltas })
    else unchanged += 1
  }
  const removed = [...old.byKey].filter(([key]) => !now.byKey.has(key)).map(([, row]) => row)
  return { comparable: true, labels, figures, changed, added, removed, unchanged }
}

/** "2 changed · 1 new · 1 gone · 3 the same", leaving out zeros; "No changes" when nothing moved. */
export function comparisonSummary(c: Extract<Comparison, { comparable: true }>): string {
  const parts = [
    c.changed.length ? `${c.changed.length} changed` : '',
    c.added.length ? `${c.added.length} new` : '',
    c.removed.length ? `${c.removed.length} gone` : '',
  ].filter(Boolean)
  if (parts.length === 0) return c.unchanged ? `No changes (${c.unchanged} row${c.unchanged === 1 ? '' : 's'} the same)` : 'No changes'
  return [...parts, c.unchanged ? `${c.unchanged} the same` : ''].filter(Boolean).join(' · ')
}
