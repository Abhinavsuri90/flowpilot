import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  History,
  ListChecks,
  Pencil,
  Play,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { api, ApiError, qk, qs } from '~/lib/api'
import { CsvError, parseTable } from '~/lib/csv'
import { formatBytes, formatCount, formatDuration, formatINR, timeAgo } from '~/lib/format'
import { LIMITS, type IntegerParameter, type WorkflowDefinition } from '~/lib/workflow/schema'
import type { RunDetail, RunSummary, WorkflowDetail } from '~/lib/types'
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Tip,
  buttonClass,
  cn,
} from '~/components/ui'
import {
  AttributionLine,
  ColumnChip,
  CopyBadge,
  ExampleBadge,
  ParameterSummary,
  RunStatusBadge,
  StepList,
  VisibilityBadge,
} from '~/components/workflow-bits'
import { FileDrop } from '~/components/file-drop'
import { ResultTable, StepFunnel } from '~/components/results'
import { ShareDialog, CopyLinkButton, shareLink } from '~/components/share-dialog'
import { ForkDialog } from '~/components/fork-dialog'
import { WhoHasAccess } from '~/components/access-panel'
import { ErrorState, PageSkeleton } from '~/components/states'
import { useToast } from '~/components/toast'

export const Route = createFileRoute('/_app/w/$workflowId/')({
  validateSearch: z.object({
    v: z.string().max(64).optional().catch(undefined),
    run: z.string().max(64).optional().catch(undefined),
  }),
  component: RecipePage,
})

function RecipePage() {
  const { workflowId } = Route.useParams()
  const { v, run: runId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [shareOpen, setShareOpen] = React.useState(false)
  const [forkOpen, setForkOpen] = React.useState(false)
  const resultRef = React.useRef<HTMLDivElement>(null)

  const detail = useQuery({
    queryKey: qk.workflow(workflowId, v),
    queryFn: () => api.get<WorkflowDetail>(`/api/workflows/${workflowId}${qs({ v })}`),
  })

  React.useEffect(() => {
    if (detail.data) document.title = `${detail.data.workflow.title} · FlowPilot`
  }, [detail.data])

  const selectRun = React.useCallback(
    (id: string | undefined, scroll = false) => {
      void navigate({ search: (prev) => ({ ...prev, run: id }), replace: true, resetScroll: false })
      if (scroll) window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    },
    [navigate],
  )

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />

  const d = detail.data
  const wf = d.workflow
  const def = d.version.definition
  const link = shareLink(wf.id, d.version.id)

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[13px] text-muted">
        <Link to="/library" search={{ tab: wf.isMine ? 'mine' : 'team' }} className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="size-3.5" /> Recipe library
        </Link>
        <ChevronRight className="size-3.5 text-faint" />
        <span className="truncate text-ink-2">{wf.title}</span>
      </nav>

      <header className="animate-rise mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{wf.title}</h1>
            <VisibilityBadge visibility={wf.visibility} workspace={wf.workspace.name} />
            {wf.isExample && <ExampleBadge />}
            {wf.forkedFrom && <CopyBadge />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={wf.owner.name} hue={wf.owner.hue} size={20} />
              {wf.isMine ? 'You' : wf.owner.name}
            </span>
            <span>·</span>
            <span>{wf.workspace.name}</span>
            <span>·</span>
            <label className="inline-flex items-center gap-1.5">
              <History className="size-3.5" aria-hidden />
              <span className="sr-only">Version</span>
              <Select
                value={d.version.id}
                onChange={(e) => {
                  const chosen = e.target.value
                  const latest = d.versions[0]?.id
                  void navigate({ search: (prev) => ({ ...prev, v: chosen === latest ? undefined : chosen }) })
                }}
                className="!h-7 !rounded-lg !py-0 !pr-7 !pl-2 text-[12.5px]"
              >
                {d.versions.map((ver) => (
                  <option key={ver.id} value={ver.id}>
                    v{ver.number}
                    {ver.number === d.latestVersionNumber ? ' (latest)' : ''} · {new Date(ver.createdAt).toLocaleDateString('en-IN')}
                  </option>
                ))}
              </Select>
            </label>
            {d.forkCount !== null && d.forkCount > 0 && (
              <>
                <span>·</span>
                <span title="Only you see this count; copies stay private to the people who made them">
                  {d.forkCount} {d.forkCount === 1 ? 'copy' : 'copies'} made
                </span>
              </>
            )}
          </div>
          {wf.forkedFrom && <AttributionLine forkedFrom={wf.forkedFrom} className="mt-2" />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton href={link} size="md" />
          {d.permissions.share.allowed && (
            <Button icon={<Share2 className="size-4" />} onClick={() => setShareOpen(true)}>
              Share
            </Button>
          )}
          {d.permissions.edit.allowed && (
            <Link to="/w/$workflowId/edit" params={{ workflowId: wf.id }} className={buttonClass('secondary')}>
              <Pencil className="size-4" /> Edit
            </Link>
          )}
          {d.permissions.fork.allowed ? (
            <Button variant="primary" icon={<Copy className="size-4" />} onClick={() => setForkOpen(true)}>
              Make a copy
            </Button>
          ) : (
            <Tip content={d.permissions.fork.reason}>
              <Button variant="primary" disabled icon={<Copy className="size-4" />}>
                Make a copy
              </Button>
            </Tip>
          )}
        </div>
      </header>

      {!d.version.isLatest && (
        <Callout
          tone="warn"
          className="animate-rise mb-5"
          title={`You're viewing version ${d.version.number} (latest is ${d.latestVersionNumber})`}
          action={
            <Button size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, v: undefined }) })}>
              View latest
            </Button>
          }
        >
          Versions never change, so this pinned version runs exactly as it did when it was saved.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <RecipeOverview detail={d} className="lg:col-start-1" />

        <aside className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          <RunPanel detail={d} onRan={(id) => selectRun(id, true)} />
        </aside>

        {runId && (
          <div ref={resultRef} className="scroll-mt-20 lg:col-start-1">
            <ResultCard runId={runId} detail={d} onClose={() => selectRun(undefined)} />
          </div>
        )}
        <MyRuns workflowId={wf.id} selectedId={runId} onSelect={(id) => selectRun(id, true)} className="lg:col-start-1" />
        <div className="lg:col-start-1">
          <WhoHasAccess workflowId={wf.id} />
        </div>
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} workflow={wf} versionId={d.version.id} versionNumber={d.version.number} />
      <ForkDialog
        target={
          forkOpen
            ? { id: wf.id, title: wf.title, versionId: d.version.id, versions: d.versions.map((ver) => ({ id: ver.id, number: ver.number })) }
            : null
        }
        onClose={() => setForkOpen(false)}
      />
    </>
  )
}

function RecipeOverview({ detail, className }: { detail: WorkflowDetail; className?: string }) {
  const def = detail.version.definition
  const columns = Object.entries(def.input.columns)
  return (
    <Card className={cn('animate-rise', className)}>
      <CardHeader
        icon={<ListChecks />}
        title="What this recipe does"
        description={detail.workflow.description || 'No description.'}
        actions={<Badge tone="outline">v{detail.version.number}</Badge>}
      />
      <div className="grid gap-5 px-5 pb-5">
        <section>
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-faint uppercase">Input · CSV with these columns</h3>
          <div className="flex flex-wrap gap-1.5">
            {columns.map(([name, type]) => (
              <ColumnChip key={name} name={name} type={type} />
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Extra columns in your file are ignored. Amounts must be whole rupees.</p>
        </section>
        <section>
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-faint uppercase">Parameters</h3>
          <ParameterSummary definition={def} />
        </section>
        <section>
          <h3 className="mb-2.5 text-[12px] font-semibold tracking-wide text-faint uppercase">Steps</h3>
          <StepList definition={def} />
        </section>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Run panel
// ---------------------------------------------------------------------------

type PreCheck =
  | { kind: 'ok'; rows: number; missing: string[]; ignored: string[] }
  | { kind: 'error'; message: string }

function defaultsFor(def: WorkflowDefinition): Record<string, string> {
  return Object.fromEntries(Object.entries(def.parameters).map(([name, p]) => [name, String(p.default)]))
}

function paramProblem(p: WorkflowDefinition['parameters'][string], raw: string): string | null {
  if (p.type === 'string') return raw.length > LIMITS.textMax ? `At most ${LIMITS.textMax} characters` : null
  if (raw.trim() === '') return null // empty → default
  if (!/^\d+$/.test(raw.trim())) return 'Whole rupees only (digits, no commas)'
  const n = Number(raw)
  const ip = p as IntegerParameter
  if (n < ip.min || n > ip.max) return `Between ${formatINR(ip.min)} and ${formatINR(ip.max)}`
  return null
}

function RunPanel({ detail, onRan }: { detail: WorkflowDetail; onRan: (runId: string) => void }) {
  const def = detail.version.definition
  const required = Object.keys(def.input.columns)
  const [file, setFile] = React.useState<File | null>(null)
  const [check, setCheck] = React.useState<PreCheck | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>(() => defaultsFor(def))
  const queryClient = useQueryClient()

  React.useEffect(() => setValues(defaultsFor(def)), [detail.version.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (picked: File) => {
    setFile(picked)
    run.reset()
    if (picked.size > LIMITS.fileBytes) {
      setCheck({ kind: 'error', message: `This file is ${formatBytes(picked.size)}; the limit is 1 MiB.` })
      return
    }
    try {
      // Header pre-check in the browser; the server re-validates every cell.
      const table = parseTable(await picked.text())
      setCheck({
        kind: 'ok',
        rows: table.records.length,
        missing: required.filter((c) => !table.headers.includes(c)),
        ignored: table.headers.filter((h) => !required.includes(h)),
      })
    } catch (err) {
      setCheck({ kind: 'error', message: err instanceof CsvError ? err.message : 'This file could not be read as CSV.' })
    }
  }

  const run = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.set('versionId', detail.version.id)
      form.set('file', file!)
      form.set('parameters', JSON.stringify(values))
      return api.upload<RunDetail>('/api/runs', form)
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(qk.run(result.id), result)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.runsAll }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      onRan(result.id)
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.runId) {
        await queryClient.invalidateQueries({ queryKey: qk.runsAll })
        onRan(err.runId)
      }
    },
  })

  const problems = Object.fromEntries(
    Object.entries(def.parameters).map(([name, p]) => [name, paramProblem(p, values[name] ?? '')]),
  )
  const paramsOk = Object.values(problems).every((p) => !p)
  const fileOk = !!file && check?.kind === 'ok' && check.missing.length === 0
  const error = run.error instanceof ApiError ? run.error : run.error ? new ApiError(0, 'ERROR', run.error.message) : null

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="relative border-b border-line bg-[linear-gradient(135deg,var(--flow-soft),transparent_70%)] px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-flow text-white shadow-[0_6px_16px_-6px_var(--glow-flow)]">
            <Play className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Run on your file</h2>
            <p className="text-[12.5px] text-muted">v{detail.version.number} · no AI involved · results visible only to you</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <FileDrop
          id="run-file"
          file={file}
          onFile={onFile}
          onClear={() => {
            setFile(null)
            setCheck(null)
            run.reset()
          }}
          compact
        />

        {check?.kind === 'error' && <Callout tone="bad">{check.message}</Callout>}
        {check?.kind === 'ok' && (
          <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[12.5px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-ink-2">Header check</span>
              <span className="tabular text-faint">{formatCount(check.rows)} rows</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {required.map((c) => {
                const ok = !check.missing.includes(c)
                return (
                  <span
                    key={c}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11.5px]',
                      ok ? 'bg-ok-soft text-ok-ink' : 'bg-bad-soft text-bad-ink',
                    )}
                  >
                    {ok ? <CheckCircle2 className="size-3" aria-hidden /> : <XCircle className="size-3" aria-hidden />}
                    {c}
                    <span className="sr-only">{ok ? 'found' : 'missing'}</span>
                  </span>
                )
              })}
            </div>
            {check.missing.length > 0 && (
              <p className="mt-2 text-bad-ink">Missing required column{check.missing.length > 1 ? 's' : ''}: {check.missing.join(', ')}</p>
            )}
            {check.ignored.length > 0 && (
              <p className="mt-2 text-muted">
                Ignored (not used, never stored): <span className="font-mono">{check.ignored.join(', ')}</span>
              </p>
            )}
          </div>
        )}

        {Object.keys(def.parameters).length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <SlidersHorizontal className="size-3.5" aria-hidden /> Parameters for this run
            </div>
            {Object.entries(def.parameters).map(([name, p]) => {
              const value = values[name] ?? ''
              const changed = value !== String(p.default)
              const problem = problems[name]
              const preview = p.type === 'integer' && /^\d+$/.test(value.trim()) ? formatINR(Number(value)) : null
              return (
                <div key={name}>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor={`param-${name}`} className="font-mono text-[12.5px] text-ink">
                      {name}
                    </label>
                    {changed && (
                      <button
                        type="button"
                        onClick={() => setValues((prev) => ({ ...prev, [name]: String(p.default) }))}
                        className="inline-flex items-center gap-1 text-[12px] text-brand-ink hover:underline"
                      >
                        <RotateCcw className="size-3" /> Reset to {p.type === 'integer' ? formatINR(p.default) : `“${p.default}”`}
                      </button>
                    )}
                  </div>
                  <Input
                    id={`param-${name}`}
                    inputMode={p.type === 'integer' ? 'numeric' : undefined}
                    value={value}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                  <p className={cn('mt-1 text-[12px]', problem ? 'text-bad-ink' : 'text-muted')}>
                    {problem ??
                      (p.type === 'integer'
                        ? `${preview ?? 'Default'} · allowed ${formatINR(p.min)}–${formatINR(p.max)}`
                        : `Default “${p.default}”`)}
                  </p>
                </div>
              )
            })}
            <p className="text-[12px] text-muted">Changing a value affects this run only. The saved recipe keeps its defaults.</p>
          </div>
        )}

        {error && (
          <Callout tone="bad" title={error.code === 'INVALID_FILE' ? 'The file needs fixing' : "The run didn't start"}>
            <p>{error.message}</p>
            {error.issues.length > 0 && (
              <ul className="mt-1.5 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-[12.5px]">
                {error.issues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            )}
          </Callout>
        )}

        <Button
          variant="flow"
          size="lg"
          className="w-full"
          icon={<Play className="size-4" />}
          loading={run.isPending}
          disabled={!fileOk || !paramsOk}
          onClick={() => run.mutate()}
        >
          {file ? 'Run recipe' : 'Choose a file to run'}
        </Button>
        <p className="text-center text-[11.5px] text-faint">Your file is processed in this request and never stored.</p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function ResultCard({ runId, detail, onClose }: { runId: string; detail: WorkflowDetail; onClose: () => void }) {
  const run = useQuery({ queryKey: qk.run(runId), queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`) })
  const ranOnOther = !!run.data && run.data.versionId !== detail.version.id
  const ranVersion = useQuery({
    queryKey: qk.workflow(detail.workflow.id, run.data?.versionId),
    queryFn: () => api.get<WorkflowDetail>(`/api/workflows/${detail.workflow.id}${qs({ v: run.data!.versionId })}`),
    enabled: ranOnOther,
  })
  const definition = ranOnOther ? ranVersion.data?.version.definition : detail.version.definition

  if (run.isPending) {
    return (
      <Card className="p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-24 w-full" />
      </Card>
    )
  }
  if (run.isError) {
    return (
      <Callout
        tone="warn"
        title="That run isn't available"
        action={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Dismiss
          </Button>
        }
      >
        Runs are private to whoever ran them, and deleted results are gone for good.
      </Callout>
    )
  }

  const r = run.data
  const params = Object.entries(r.parameters)
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<Table2 />}
        tone="flow"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Result <RunStatusBadge status={r.status} errorCode={r.errorCode} />
          </span>
        }
        description={
          <span className="tabular">
            v{r.versionNumber}
            {r.inputName ? ` · ${r.inputName}` : ''}
            {r.inputRows !== null ? ` · ${formatCount(r.inputRows)} rows read` : ''} · {formatDuration(r.durationMs)} · {timeAgo(r.createdAt)}
          </span>
        }
        actions={
          <>
            {r.status === 'succeeded' && (
              <a href={`/api/runs/${r.id}/csv`} download className={buttonClass('secondary', 'sm')}>
                <Download className="size-3.5" /> CSV
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
              aria-label="Close result"
            >
              <X className="size-4" />
            </button>
          </>
        }
      />
      <div className="space-y-5 px-5 pb-5">
        {r.summary && (
          <div className="flex flex-wrap items-center gap-1.5">
            {r.summary.split(' · ').map((chip, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-lg px-2 py-1 text-[12.5px]',
                  i === 0 && r.rowCount ? 'bg-flow-soft font-semibold text-flow-ink' : 'bg-sunken font-mono text-ink-2',
                )}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {params.length > 0 && (
          <p className="text-[12.5px] text-muted">
            Run with{' '}
            {params.map(([name, value], i) => (
              <span key={name}>
                {i > 0 && ', '}
                <code className="text-ink-2">{name}</code> = <span className="tabular font-medium text-ink-2">{typeof value === 'number' ? formatINR(value) : `“${value}”`}</span>
              </span>
            ))}
            {ranOnOther && ' · ran on a different version than the one shown above'}
          </p>
        )}

        {r.status === 'failed' ? (
          <Callout tone="bad" title={r.errorCode === 'TIMEOUT' ? 'The run took too long' : r.errorCode === 'STALE' ? 'The run did not finish' : 'The run failed'}>
            {r.errorMessage ?? 'The run failed.'} <span className="font-mono text-[12px] opacity-70">({r.errorCode})</span>
          </Callout>
        ) : r.status === 'running' ? (
          <Callout tone="info" title="Still running">
            Refresh in a moment. Runs that don't finish within a minute are marked as failed.
          </Callout>
        ) : r.rows.length === 0 ? (
          <EmptyState
            title="No rows matched"
            description={
              Object.keys(r.parameters).length
                ? 'Nothing in this file passed every step. Try a different parameter value, such as a higher threshold.'
                : 'Nothing in this file passed every step.'
            }
          />
        ) : (
          <ResultTable columns={r.columns} rows={r.rows} caption={`Result of run ${r.id}`} />
        )}

        {r.stepLog.length > 0 && (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-faint uppercase">Rows through each step</h3>
            <StepFunnel stepLog={r.stepLog} definition={definition} inputRows={r.inputRows ?? r.stepLog[0]?.rowsIn ?? 0} />
          </div>
        )}
        {r.ignoredColumns.length > 0 && (
          <p className="text-[12px] text-muted">
            Ignored columns (not used by this recipe, never stored): <span className="font-mono">{r.ignoredColumns.join(', ')}</span>
          </p>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// My runs of this recipe
// ---------------------------------------------------------------------------

function MyRuns({
  workflowId,
  selectedId,
  onSelect,
  className,
}: {
  workflowId: string
  selectedId?: string
  onSelect: (id: string | undefined) => void
  className?: string
}) {
  const runs = useQuery({
    queryKey: qk.runs(workflowId),
    queryFn: () => api.get<{ runs: RunSummary[] }>(`/api/runs${qs({ workflowId })}`),
  })
  const [confirm, setConfirm] = React.useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: number }>(`/api/runs${qs({ workflowId })}`),
    onSuccess: async (res) => {
      setConfirm(false)
      onSelect(undefined)
      queryClient.removeQueries({ queryKey: ['run'] })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.runsAll }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      toast.show({ tone: 'ok', title: `Deleted ${res.deleted} result${res.deleted === 1 ? '' : 's'}` })
    },
  })

  const list = runs.data?.runs ?? []
  return (
    <Card className={className}>
      <CardHeader
        icon={<History />}
        title="My runs of this recipe"
        description="Only you can see these."
        actions={
          list.some((r) => r.status !== 'running') ? (
            <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)}>
              Delete my results
            </Button>
          ) : undefined
        }
      />
      <div className="px-5 pb-5">
        {runs.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
            You haven't run this recipe yet. Choose a file in the panel to run it.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {list.map((r) => {
              const params = Object.entries(r.parameters)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    aria-current={r.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2',
                      r.id === selectedId && 'bg-brand-soft/50',
                    )}
                  >
                    <RunStatusBadge status={r.status} errorCode={r.errorCode} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        v{r.versionNumber} · {r.inputName ?? 'file'}
                        {r.rowCount !== null && <span className="font-normal text-muted"> · {r.rowCount} row{r.rowCount === 1 ? '' : 's'}</span>}
                      </span>
                      {params.length > 0 && (
                        <span className="block truncate text-[12px] text-muted">
                          {params.map(([k, v]) => `${k} ${typeof v === 'number' ? formatINR(v) : `“${v}”`}`).join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[12px] text-faint">{timeAgo(r.createdAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        icon={<Trash2 />}
        title="Delete your results for this recipe?"
        description="This removes your finished runs and their stored results. Other people's runs and the recipe are not affected."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete my results
            </Button>
          </>
        }
      />
    </Card>
  )
}
