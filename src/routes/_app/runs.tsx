import * as React from 'react'
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { z } from 'zod'
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, History, Trash2 } from 'lucide-react'
import { api, qk, qs } from '~/lib/api'
import { formatCount, formatDateTime, formatDuration, formatINR, timeAgo } from '~/lib/format'
import type { RunList, RunSummary } from '~/lib/types'
import { Button, Card, Dialog, EmptyState, PageHeader, Segmented, Skeleton, buttonClass, cn } from '~/components/ui'
import { RunStatusBadge } from '~/components/workflow-bits'
import { ErrorState } from '~/components/states'
import { useToast } from '~/components/toast'

const Search_ = z.object({ status: z.enum(['all', 'succeeded', 'failed', 'running']).default('all').catch('all') })

export const Route = createFileRoute('/_app/runs')({
  validateSearch: Search_,
  search: { middlewares: [stripSearchParams({ status: 'all' })] },
  head: () => ({ meta: [{ title: 'My runs · FlowPilot' }] }),
  component: RunsPage,
})

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
})
const helper = createColumnHelper<typeof features, RunSummary>()
const EMPTY: RunSummary[] = []
const NO_COUNTS: RunList['counts'] = { all: 0, running: 0, succeeded: 0, failed: 0 }
/** Most runs listed at once; the counts above the table are always exact. */
const RUNS_SHOWN = 500

const COLUMNS: Array<ColumnDef<typeof features, RunSummary, any>> = [
  helper.accessor((r) => r.workflowTitle ?? '', {
    id: 'recipe',
    header: 'Recipe',
    sortFn: 'text',
    cell: ({ row }) => {
      const r = row.original
      return r.recipeAvailable ? (
        <Link
          to="/w/$workflowId"
          params={{ workflowId: r.workflowId }}
          search={{ run: r.id, v: r.versionId }}
          className="font-medium text-ink hover:text-brand-ink"
        >
          {r.workflowTitle}
        </Link>
      ) : (
        <span className="text-muted italic" title="The recipe was made private or you lost access; your result is still yours">
          Recipe no longer available
        </span>
      )
    },
  }),
  helper.accessor('versionNumber', { header: 'Version', sortFn: 'basic', cell: (info) => `v${info.getValue()}` }),
  helper.accessor('status', {
    header: 'Status',
    sortFn: 'text',
    cell: ({ row }) => <RunStatusBadge status={row.original.status} errorCode={row.original.errorCode} />,
  }),
  helper.accessor((r) => r.inputName ?? '', { id: 'file', header: 'File', sortFn: 'text', cell: (info) => <span className="font-mono text-[12px]">{info.getValue() || '—'}</span> }),
  helper.accessor((r) => r.rowCount ?? -1, {
    id: 'rows',
    header: 'Rows',
    sortFn: 'basic',
    cell: ({ row }) => <span className="tabular">{row.original.rowCount ?? '—'}</span>,
  }),
  helper.accessor((r) => Object.entries(r.parameters).map(([k, v]) => `${k}=${v}`).join(', '), {
    id: 'parameters',
    header: 'Parameters',
    sortFn: 'text',
    cell: ({ row }) => {
      const entries = Object.entries(row.original.parameters)
      return entries.length ? (
        <span className="text-[12.5px] text-muted">
          {entries.map(([k, v]) => `${k} ${typeof v === 'number' ? formatINR(v) : `“${v}”`}`).join(', ')}
        </span>
      ) : (
        <span className="text-faint">—</span>
      )
    },
  }),
  helper.accessor((r) => r.durationMs ?? -1, {
    id: 'duration',
    header: 'Took',
    sortFn: 'basic',
    cell: ({ row }) => <span className="tabular text-muted">{formatDuration(row.original.durationMs)}</span>,
  }),
  helper.accessor((r) => Date.parse(r.createdAt), {
    id: 'when',
    header: 'When',
    sortFn: 'basic',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted" title={formatDateTime(row.original.createdAt)}>
        {timeAgo(row.original.createdAt)}
      </span>
    ),
  }),
  helper.display({
    id: 'csv',
    header: '',
    cell: ({ row }) =>
      row.original.status === 'succeeded' ? (
        <a href={`/api/runs/${row.original.id}/csv`} download className={buttonClass('ghost', 'sm')} aria-label={`Download CSV of run ${row.original.id}`}>
          <Download className="size-3.5" /> CSV
        </a>
      ) : null,
  }),
]

function RunsPage() {
  const { status } = Route.useSearch()
  const navigate = useNavigate({ from: '/runs' })
  // Filtered on the server, so a status tab lists that status's latest runs even
  // for someone with thousands; the counts come back exact.
  const runs = useQuery({
    queryKey: qk.runs(undefined, status),
    queryFn: () => api.get<RunList>(`/api/runs${qs({ limit: RUNS_SHOWN, status: status === 'all' ? undefined : status })}`),
    placeholderData: keepPreviousData,
  })
  const [confirm, setConfirm] = React.useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const counts = runs.data?.counts ?? NO_COUNTS
  const filtered = runs.data?.runs ?? EMPTY
  const table = useTable({ features, columns: COLUMNS, data: filtered })

  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: number }>('/api/runs'),
    onSuccess: async (res) => {
      setConfirm(false)
      queryClient.removeQueries({ queryKey: ['run'] })
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.runsAll }), queryClient.invalidateQueries({ queryKey: qk.dashboard })])
      toast.show({ tone: 'ok', title: `Deleted ${res.deleted} result${res.deleted === 1 ? '' : 's'}`, description: 'Recipes and other people’s runs are unaffected.' })
    },
  })

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="My runs"
        description="Every run you’ve made, across recipes. Only you can see these: not recipe owners, not admins."
        actions={
          counts.all > counts.running ? (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>
              Delete all my results
            </Button>
          ) : undefined
        }
      />

      <div className="animate-rise mb-4">
        <Segmented
          label="Filter by status"
          value={status}
          onChange={(value) => navigate({ search: { status: value } })}
          items={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'succeeded', label: 'Succeeded', count: counts.succeeded },
            { value: 'failed', label: 'Failed', count: counts.failed },
            ...(counts.running ? [{ value: 'running' as const, label: 'Running', count: counts.running }] : []),
          ]}
        />
      </div>

      {runs.isPending ? (
        <Card className="space-y-3 p-5">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </Card>
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
      ) : counts.all === 0 ? (
        <EmptyState
          icon={<History />}
          title="No runs yet"
          description="Open a recipe from the library and run it on your own file. Your results will be listed here."
          action={
            <Link to="/library" className={buttonClass('secondary')}>
              Open the library
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No ${status} runs`} description="Try another filter." />
      ) : (
        <Card className="animate-rise overflow-hidden">
          <div className="scrollbar-thin relative overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13.5px]">
              <caption className="sr-only">My runs</caption>
              <thead className="bg-surface-2">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => {
                      const sorted = header.column.getIsSorted()
                      const sortable = header.column.getCanSort() && header.column.id !== 'csv'
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                          className="border-b border-line px-4 py-2.5 text-left text-[12px] font-medium text-muted"
                        >
                          {sortable ? (
                            <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-ink">
                              <table.FlexRender header={header} />
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3.5 text-brand" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3.5 text-brand" />
                              ) : (
                                <ChevronsUpDown className="size-3.5 opacity-40" />
                              )}
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={cn('border-b border-line last:border-0 hover:bg-surface-2')}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 align-middle">
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {counts[status] > filtered.length && (
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
              Showing your latest {formatCount(filtered.length)} of {formatCount(counts[status])} runs. Older results are kept; delete them
              here when you no longer need them.
            </p>
          )}
        </Card>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        icon={<Trash2 />}
        size="sm"
        title="Delete all your results?"
        description="This removes every finished run you’ve made and its stored result. It can’t be undone. Recipes and other people’s runs are not affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete all my results
            </Button>
          </>
        }
      />
    </>
  )
}
