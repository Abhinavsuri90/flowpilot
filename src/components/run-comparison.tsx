import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, ChevronDown, GitCompareArrows } from 'lucide-react'
import { api, qk, qs } from '~/lib/api'
import { compareResults, comparisonSummary, type Comparison } from '~/lib/compare'
import { formatCount, formatDateTime, formatINR, timeAgo } from '~/lib/format'
import type { RunDetail, RunList, RunSummary } from '~/lib/types'
import type { Column, Row } from '~/lib/workflow/schema'
import { Badge, Select, Skeleton, cn } from './ui'

// "What changed since last time" for a result: the report someone reruns every
// week, compared row by row with another of their own runs of the same recipe.
// Runs are private, so only the viewer's own runs are ever offered.

const SHOWN = 50

function formatValue(value: Row[string] | undefined, column: Column | undefined): string {
  if (typeof value !== 'number') return String(value ?? '')
  return column?.type === 'integer_inr' ? formatINR(value) : formatCount(value)
}

/** "+₹20,000" / "−₹50,000" (a real minus sign). */
function formatDelta(delta: number, column: Column | undefined): string {
  return `${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta), column)}`
}

const runLabel = (run: Pick<RunSummary, 'versionNumber' | 'inputName' | 'createdAt'>) =>
  `${formatDateTime(run.createdAt)} · v${run.versionNumber}${run.inputName ? ` · ${run.inputName}` : ''}`

/**
 * Compares a finished run with another of the viewer's successful runs of the same
 * recipe: by default the latest one before it. Collapsed to a one-line summary
 * until opened.
 */
export function RunComparison({ run }: { run: RunDetail }) {
  const runs = useQuery({
    queryKey: qk.runs(run.workflowId),
    queryFn: () => api.get<RunList>(`/api/runs${qs({ workflowId: run.workflowId })}`),
  })
  const candidates = React.useMemo(
    () => (runs.data?.runs ?? []).filter((c) => c.id !== run.id && c.status === 'succeeded'),
    [runs.data, run.id],
  )
  const [chosen, setChosen] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const fallback = candidates.find((c) => c.createdAt <= run.createdAt) ?? candidates[0]
  const otherId = chosen && candidates.some((c) => c.id === chosen) ? chosen : fallback?.id
  const other = useQuery({
    queryKey: qk.run(otherId ?? 'none'),
    queryFn: () => api.get<RunDetail>(`/api/runs/${otherId}`),
    enabled: Boolean(otherId),
  })

  if (!otherId) return null
  // Always read from the older run to the newer one.
  const otherIsOlder = !other.data || other.data.createdAt <= run.createdAt
  const [before, after] = other.data ? (otherIsOlder ? [other.data, run] : [run, other.data]) : [null, null]
  const comparison: Comparison | null = before && after ? compareResults(before, after) : null
  const summary = comparison ? (comparison.comparable ? comparisonSummary(comparison) : 'Can’t be compared row by row') : null
  const otherSummary = candidates.find((c) => c.id === otherId)
  const heading = otherSummary
    ? otherIsOlder
      ? `Since your run of ${timeAgo(otherSummary.createdAt)}`
      : `Until your later run of ${timeAgo(otherSummary.createdAt)}`
    : 'Compared with another run'

  return (
    <section aria-label="Changes between runs" className="rounded-xl border border-line bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <GitCompareArrows className="size-4 shrink-0 text-brand" aria-hidden />
        <span className="text-[13px] font-semibold text-ink">{heading}</span>
        {summary ? (
          <span className="text-[13px] text-ink-2">{summary}</span>
        ) : (
          <Skeleton className="h-3.5 w-40" />
        )}
        <ChevronDown className={cn('ml-auto size-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Hide the changes' : 'Show the changes'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            Compare with
            <Select
              aria-label="Run to compare with"
              value={otherId}
              onChange={(e) => setChosen(e.target.value)}
              wrapperClassName="min-w-0 flex-1 sm:flex-none"
              className="h-8 text-[12.5px]"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {runLabel(c)}
                </option>
              ))}
            </Select>
          </label>
          {other.isError ? (
            <p className="text-[13px] text-muted">That run isn’t available any more.</p>
          ) : !comparison || !before || !after ? (
            <Skeleton className="h-20" />
          ) : !comparison.comparable ? (
            <p className="text-[13px] text-ink-2">{comparison.detail}</p>
          ) : (
            <ChangesTable comparison={comparison} columns={after.columns} beforeLabel={runLabel(before)} afterLabel={runLabel(after)} />
          )}
        </div>
      )}
    </section>
  )
}

function ChangesTable({
  comparison: c,
  columns,
  beforeLabel,
  afterLabel,
}: {
  comparison: Extract<Comparison, { comparable: true }>
  columns: Column[]
  beforeLabel: string
  afterLabel: string
}) {
  const [all, setAll] = React.useState(false)
  const byName = new Map(columns.map((col) => [col.name, col]))
  const lines = [
    ...c.changed.map((change) => ({ kind: 'changed' as const, row: change.after, before: change.before, deltas: change.deltas })),
    ...c.added.map((row) => ({ kind: 'new' as const, row, before: null, deltas: {} as Record<string, number> })),
    ...c.removed.map((row) => ({ kind: 'gone' as const, row, before: null, deltas: {} as Record<string, number> })),
  ]
  if (lines.length === 0) return <p className="text-[13px] text-ink-2">Every row is the same in both runs.</p>
  const shown = all ? lines : lines.slice(0, SHOWN)
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">
        From {beforeLabel} to {afterLabel}. Rows are matched by {c.labels.length ? c.labels.join(', ') : 'position (one overall row)'}.
      </p>
      <div className="scrollbar-thin relative overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <caption className="sr-only">Changes between the two runs</caption>
          <thead className="bg-surface-2">
            <tr>
              {c.labels.map((label) => (
                <th key={label} scope="col" className="border-b border-line px-3 py-2 text-left font-mono text-[12px] font-medium text-muted">
                  {label}
                </th>
              ))}
              {c.figures.map((figure) => (
                <th key={figure} scope="col" className="border-b border-line px-3 py-2 text-right font-mono text-[12px] font-medium text-muted">
                  {figure}
                </th>
              ))}
              <th scope="col" className="border-b border-line px-3 py-2 text-left text-[12px] font-medium text-muted">
                <span className="sr-only">Change</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((line, i) => (
              <tr key={i} className={cn('border-b border-line last:border-0', line.kind === 'gone' && 'text-muted')}>
                {c.labels.map((label) => (
                  <td key={label} className={cn('px-3 py-2', line.kind === 'gone' ? 'line-through decoration-line-strong' : 'text-ink')}>
                    {formatValue(line.row[label], byName.get(label))}
                  </td>
                ))}
                {c.figures.map((figure) => {
                  const column = byName.get(figure)
                  const delta = line.deltas[figure]
                  return (
                    <td key={figure} className="tabular px-3 py-2 text-right">
                      {delta !== undefined && line.before ? (
                        <span className="inline-flex flex-col items-end">
                          <span>
                            <span className="text-muted">{formatValue(line.before[figure], column)}</span> →{' '}
                            <span className="font-medium text-ink">{formatValue(line.row[figure], column)}</span>
                          </span>
                          <span className={cn('inline-flex items-center gap-0.5 text-[12px] font-medium', delta > 0 ? 'text-flow-ink' : 'text-warn-ink')}>
                            {delta > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
                            {formatDelta(delta, column)}
                          </span>
                        </span>
                      ) : (
                        formatValue(line.row[figure], column)
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2">
                  {line.kind === 'new' ? <Badge tone="flow">New</Badge> : line.kind === 'gone' ? <Badge tone="neutral">Gone</Badge> : <Badge tone="brand">Changed</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-[12.5px] font-medium text-brand-ink hover:underline">
          Show all {formatCount(lines.length)} changes
        </button>
      )}
    </div>
  )
}
