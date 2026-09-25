import * as React from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, FileSpreadsheet, Filter, Sigma } from 'lucide-react'
import { formatCount, formatINR } from '~/lib/format'
import type { Column, Row, StepLogEntry, WorkflowDefinition } from '~/lib/workflow/schema'
import { describeRecipe } from '~/lib/workflow/describe'
import { cn } from './ui'

// ---------------------------------------------------------------------------
// Sortable result grid (TanStack Table v9)
// ---------------------------------------------------------------------------

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
})
const helper = createColumnHelper<typeof features, Row>()
const EMPTY_ROWS: Row[] = []

export function ResultTable({ columns, rows, caption }: { columns: Column[]; rows: Row[]; caption?: string }) {
  const defs = React.useMemo(
    (): Array<ColumnDef<typeof features, Row, any>> =>
      columns.map((column) =>
        helper.accessor((row) => row[column.name]!, {
          id: column.name,
          header: column.name,
          sortFn: column.type === 'integer_inr' ? 'basic' : 'text',
          sortDescFirst: column.type === 'integer_inr',
          cell: (info) => {
            const value = info.getValue()
            return column.type === 'integer_inr' && typeof value === 'number' ? formatINR(value) : String(value ?? '')
          },
        }),
      ),
    [columns],
  )
  const table = useTable({ features, columns: defs, data: rows.length ? rows : EMPTY_ROWS })
  const typeOf = new Map(columns.map((c) => [c.name, c.type]))

  return (
    <div className="scrollbar-thin overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-max border-collapse text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-2">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const amount = typeOf.get(header.column.id) === 'integer_inr'
                const sorted = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    className={cn('border-b border-line px-4 py-2.5 font-medium', amount ? 'text-right' : 'text-left')}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1.5 font-mono text-[12px] text-muted hover:text-ink',
                        amount && 'flex-row-reverse',
                      )}
                      title={`Sort by ${header.column.id}`}
                    >
                      <table.FlexRender header={header} />
                      {sorted === 'asc' ? (
                        <ArrowUp className="size-3.5 text-brand" aria-hidden />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="size-3.5 text-brand" aria-hidden />
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0 hover:bg-surface-2">
              {row.getAllCells().map((cell) => {
                const amount = typeOf.get(cell.column.id) === 'integer_inr'
                return (
                  <td
                    key={cell.id}
                    className={cn('px-4 py-2.5', amount ? 'tabular text-right font-medium text-flow-ink' : 'text-ink')}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows through each step
// ---------------------------------------------------------------------------

export function StepFunnel({ stepLog, definition, inputRows }: { stepLog: StepLogEntry[]; definition?: WorkflowDefinition; inputRows: number }) {
  const labels = definition ? describeRecipe(definition) : []
  const max = Math.max(inputRows, ...stepLog.map((s) => s.rowsOut), 1)
  const bars = [
    { key: 'input', icon: <FileSpreadsheet />, label: 'Your file', count: inputRows, sub: 'rows read' },
    ...stepLog.map((s, i) => ({
      key: s.stepId,
      icon: s.type === 'group_sum' ? <Sigma /> : <Filter />,
      label: labels[i] ?? s.stepId,
      count: s.rowsOut,
      sub: s.type === 'group_sum' ? `groups from ${formatCount(s.rowsIn)} rows` : `of ${formatCount(s.rowsIn)} rows kept`,
    })),
  ]
  return (
    <ol className="space-y-2.5" aria-label="Rows through each step">
      {bars.map((bar, i) => (
        <li key={bar.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2">
            <span className="text-faint [&_svg]:size-3.5">{bar.icon}</span>
            <span className="truncate">{bar.label}</span>
          </div>
          <div className="tabular text-right text-[12.5px]">
            <span className="font-semibold text-ink">{formatCount(bar.count)}</span>{' '}
            <span className="text-faint">{bar.sub}</span>
          </div>
          <div className="col-span-2 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className={cn('h-full rounded-full transition-[width] duration-700', i === 0 ? 'bg-line-strong' : 'bg-[linear-gradient(90deg,var(--flow),var(--brand))]')}
              style={{ width: `${Math.max(bar.count > 0 ? 2 : 0, (bar.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}
