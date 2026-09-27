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
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, FileSpreadsheet } from 'lucide-react'
import { formatCount, formatINR } from '~/lib/format'
import { isNumericType, type Column, type Row, type StepLogEntry, type WorkflowDefinition } from '~/lib/workflow/schema'
import { describeRecipe } from '~/lib/workflow/describe'
import { toTsv } from '~/lib/csv'
import { cn } from './ui'
import { StepIcon } from './workflow-bits'
import { ChartTableToggle, ResultChart, chartable } from './charts'

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

const PAGE = 100

export function ResultTable({ columns, rows, caption }: { columns: Column[]; rows: Row[]; caption?: string }) {
  // Large results render in pages so the browser stays responsive; sorting still covers every row.
  const [visible, setVisible] = React.useState(PAGE)
  const defs = React.useMemo(
    (): Array<ColumnDef<typeof features, Row, any>> =>
      columns.map((column) =>
        helper.accessor((row) => row[column.name]!, {
          id: column.name,
          header: column.name,
          sortFn: isNumericType(column.type) ? 'basic' : 'text',
          sortDescFirst: isNumericType(column.type),
          cell: (info) => {
            const value = info.getValue()
            if (typeof value !== 'number') return String(value ?? '')
            return column.type === 'integer_inr' ? formatINR(value) : column.type === 'integer' ? formatCount(value) : String(value)
          },
        }),
      ),
    [columns],
  )
  const table = useTable({ features, columns: defs, data: rows.length ? rows : EMPTY_ROWS })
  const typeOf = new Map(columns.map((c) => [c.name, c.type]))
  const allRows = table.getRowModel().rows
  const shownRows = allRows.slice(0, visible)

  return (
    // `relative` makes the scroller the containing block of the sr-only labels in the
    // cells; without it they escape the scroll box and widen the whole page on phones.
    <div className="scrollbar-thin relative overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-max border-collapse text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-2">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const amount = isNumericType(typeOf.get(header.column.id))
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
          {shownRows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0 hover:bg-surface-2">
              {row.getAllCells().map((cell) => {
                const amount = isNumericType(typeOf.get(cell.column.id))
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
      {allRows.length > shownRows.length && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-muted">
          <span>
            Showing {formatCount(shownRows.length)} of {formatCount(allRows.length)} rows. The CSV download has all of them.
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="font-medium text-brand-ink hover:underline">
              Show {formatCount(Math.min(PAGE, allRows.length - shownRows.length))} more
            </button>
            <button type="button" onClick={() => setVisible(allRows.length)} className="font-medium text-brand-ink hover:underline">
              Show all
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

/** The result as a table (copyable into a spreadsheet or a message), or as a bar chart when it has a figure to plot. */
export function ResultView({ columns, rows, caption }: { columns: Column[]; rows: Row[]; caption?: string }) {
  const [view, setView] = React.useState<'table' | 'chart'>('table')
  const [copied, setCopied] = React.useState(false)
  const canChart = chartable(columns, rows)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(columns.map((c) => c.name), rows))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard access (insecure context or denied): the CSV download still works.
    }
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] font-medium text-muted hover:text-ink"
          aria-label="Copy the table (tab-separated, pastes into a spreadsheet)"
        >
          <Copy className="size-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy table'}
        </button>
        {canChart && <ChartTableToggle view={view} onChange={setView} />}
      </div>
      {canChart && view === 'chart' ? <ResultChart columns={columns} rows={rows} /> : <ResultTable columns={columns} rows={rows} caption={caption} />}
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
      icon: <StepIcon type={s.type} />,
      label: labels[i] ?? s.stepId,
      count: s.rowsOut,
      sub:
        s.type === 'group_sum' || s.type === 'aggregate'
          ? `group${s.rowsOut === 1 ? '' : 's'} from ${formatCount(s.rowsIn)} rows`
          : s.type === 'sort' || s.type === 'select'
            ? 'rows, same count'
            : `of ${formatCount(s.rowsIn)} rows kept`,
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
