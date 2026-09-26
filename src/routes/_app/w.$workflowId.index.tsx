import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
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
import { CsvError, literalMismatch, missingColumnsMessage, parseForContract, parseTable } from '~/lib/csv'
import { formatParameterValue, parameterUnits, type ParameterUnit } from '~/lib/workflow/describe'
import { formatDate, isIsoDate, todayIso, usesRelativeDates } from '~/lib/dates'
import { compatibleSamples, fetchSample } from '~/lib/samples'
import { exportFileName, resultWorkbook, saveBlob } from '~/lib/spreadsheet'
import { formatBytes, formatCount, formatDuration, timeAgo } from '~/lib/format'
import { LIMITS, type IntegerParameter, type WorkflowDefinition } from '~/lib/workflow/schema'
import type { ApiIssue, RunDetail, RunList, WorkflowDetail } from '~/lib/types'
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
  Spinner,
  Tip,
  buttonClass,
  cn,
} from '~/components/ui'
import {
  ArchivedBadge,
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
  const [archiveOpen, setArchiveOpen] = React.useState(false)
  const resultRef = React.useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch(`/api/workflows/${workflowId}`, { archived }),
    onSuccess: async (_res, archived) => {
      setArchiveOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workflowAll(workflowId) }),
        queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      toast.show(
        archived
          ? { tone: 'ok', title: 'Recipe archived', description: 'It left the library and can’t be run until you restore it. Its history and runs are kept.' }
          : { tone: 'ok', title: 'Recipe restored', description: 'It’s back in the library and runs again.' },
      )
    },
    onError: (err) => toast.show({ tone: 'bad', title: 'Not changed', description: err instanceof Error ? err.message : String(err) }),
  })

  const detail = useQuery({
    queryKey: qk.workflow(workflowId, v),
    queryFn: () => api.get<WorkflowDetail>(`/api/workflows/${workflowId}${qs({ v })}`),
    // Switching versions keeps this recipe on screen (and the run panel's chosen
    // file) until the other version arrives; another recipe never shows stale data.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === workflowId ? previous : undefined),
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
  const link = shareLink(wf.id, d.version.id)
  // Another version is loading; the one on screen stays until it arrives.
  const switching = detail.isPlaceholderData

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
            {wf.archivedAt && <ArchivedBadge />}
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
                disabled={switching}
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
              {switching && <Spinner className="size-3.5" />}
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
          <CopyLinkButton href={link} size="md" privateNote={wf.visibility === 'private'} />
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
          {wf.isMine && !wf.archivedAt && (
            <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </header>

      {wf.archivedAt && (
        <Callout
          tone="warn"
          className="animate-rise mb-5"
          icon={<Archive />}
          title={`Archived ${timeAgo(wf.archivedAt)}`}
          action={
            wf.isMine ? (
              <Button size="sm" loading={archive.isPending} icon={<ArchiveRestore className="size-3.5" />} onClick={() => archive.mutate(false)}>
                Restore
              </Button>
            ) : undefined
          }
        >
          {wf.isMine
            ? 'It is out of the library and can’t be run, copied or edited. Restore it to use it again; its versions and runs are kept.'
            : 'Its owner retired it, so it can’t be run or copied. Your earlier results are still under My runs.'}
        </Callout>
      )}

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
          <RunPanel detail={d} busy={switching} onRan={(id) => selectRun(id, true)} />
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
      <Dialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        size="sm"
        icon={<Archive />}
        title={`Archive “${wf.title}”?`}
        description="It leaves the library and can't be run or copied until you restore it. Versions, runs and copies people already made are kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(true)}>
              Archive recipe
            </Button>
          </>
        }
      />
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

type PreCheck = { versionId: string } & (
  | {
      kind: 'ok'
      rows: number
      missing: string[]
      /** "Missing required column: status (the file has "Status")…" */
      missingMessage: string | null
      ignored: string[]
      /** Line-numbered problems the server would reject, found here first. */
      issues: ApiIssue[]
      issueSummary: string | null
      /** Distinct values of each text column, for "this never matches" hints. */
      valuesByColumn: Record<string, string[]>
    }
  | { kind: 'error'; message: string; issues: ApiIssue[] }
)

/**
 * Checks a file against one version's input contract, in the browser, with the
 * same parser as the server (which still re-validates every cell). Re-run
 * whenever the version changes: another version can need other columns.
 */
async function checkFile(picked: File, versionId: string, def: WorkflowDefinition): Promise<PreCheck> {
  if (picked.size > LIMITS.fileBytes) {
    return { versionId, kind: 'error', message: `This file is ${formatBytes(picked.size)}; the limit is 1 MiB.`, issues: [] }
  }
  try {
    // Bytes, not text(): the parser rejects files that aren't UTF-8 instead of guessing.
    const bytes = new Uint8Array(await picked.arrayBuffer())
    const table = parseTable(bytes)
    const required = Object.keys(def.input.columns)
    const missing = required.filter((c) => !table.headers.includes(c))
    let issues: ApiIssue[] = []
    let issueSummary: string | null = null
    const valuesByColumn: Record<string, string[]> = {}
    if (missing.length === 0) {
      try {
        const parsed = parseForContract(bytes, def.input.columns)
        for (const [name, type] of Object.entries(def.input.columns)) {
          if (type === 'string') valuesByColumn[name] = [...new Set(parsed.rows.map((r) => String(r[name])))].slice(0, 200)
        }
      } catch (err) {
        if (!(err instanceof CsvError)) throw err
        issues = err.issues
        issueSummary = err.message
      }
    }
    return {
      versionId,
      kind: 'ok',
      rows: table.records.length,
      missing,
      missingMessage: missing.length ? missingColumnsMessage(missing, table.headers) : null,
      ignored: table.headers.filter((h) => !required.includes(h)),
      issues,
      issueSummary,
      valuesByColumn,
    }
  } catch (err) {
    return err instanceof CsvError
      ? { versionId, kind: 'error', message: err.message, issues: err.issues }
      : { versionId, kind: 'error', message: 'This file could not be read as CSV.', issues: [] }
  }
}

function defaultsFor(def: WorkflowDefinition): Record<string, string> {
  return Object.fromEntries(Object.entries(def.parameters).map(([name, p]) => [name, String(p.default)]))
}

function paramProblem(p: WorkflowDefinition['parameters'][string], raw: string, unit: ParameterUnit | undefined): string | null {
  if (p.type === 'string') return raw.length > LIMITS.textMax ? `At most ${LIMITS.textMax} characters` : null
  if (raw.trim() === '') return null // empty → default
  if (p.type === 'date') return isIsoDate(raw.trim()) ? null : 'A date like 2026-04-03'
  if (!/^\d+$/.test(raw.trim())) return unit === 'number' ? 'Whole numbers only (digits, no commas)' : 'Whole rupees only (digits, no commas)'
  const n = Number(raw)
  const ip = p as IntegerParameter
  if (n < ip.min || n > ip.max) return `Between ${formatParameterValue(ip.min, unit)} and ${formatParameterValue(ip.max, unit)}`
  return null
}

function RunPanel({ detail, busy, onRan }: { detail: WorkflowDetail; busy: boolean; onRan: (runId: string) => void }) {
  const def = detail.version.definition
  const versionId = detail.version.id
  const required = Object.keys(def.input.columns)
  const [file, setFile] = React.useState<File | null>(null)
  const [latestCheck, setCheck] = React.useState<PreCheck | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>(() => defaultsFor(def))
  const [valuesFor, setValuesFor] = React.useState(versionId)
  // The day "last month" or "30 days ago" count from: today here, unless the runner picks another day.
  const relativeDates = usesRelativeDates(def)
  const [asOf, setAsOf] = React.useState(() => todayIso())
  const queryClient = useQueryClient()

  // Switching versions keeps the chosen file but resets parameters to that
  // version's defaults (adjusted during render, so no frame shows stale values).
  if (valuesFor !== versionId) {
    setValuesFor(versionId)
    setValues(defaultsFor(def))
  }
  // A check made for another version is never shown or trusted.
  const check = latestCheck?.versionId === versionId ? latestCheck : null

  // (Re)check the file against the version on screen.
  React.useEffect(() => {
    if (!file) return
    let current = true
    void checkFile(file, versionId, def).then((result) => {
      if (current) setCheck(result)
    })
    return () => {
      current = false
    }
  }, [file, versionId]) // eslint-disable-line react-hooks/exhaustive-deps -- def belongs to versionId

  const onFile = (picked: File) => {
    setFile(picked)
    setCheck(null)
    run.reset()
  }

  const run = useMutation({
    mutationFn: (vars: { versionId: string }) => {
      const form = new FormData()
      form.set('versionId', vars.versionId)
      form.set('file', file!)
      form.set('parameters', JSON.stringify(values))
      if (relativeDates) form.set('asOf', asOf)
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

  const units = parameterUnits(def)
  const problems = Object.fromEntries(
    Object.entries(def.parameters).map(([name, p]) => [name, paramProblem(p, values[name] ?? '', units[name])]),
  )
  const asOfOk = !relativeDates || isIsoDate(asOf)
  const paramsOk = Object.values(problems).every((p) => !p) && asOfOk
  const fileOk = !!file && check?.kind === 'ok' && check.missing.length === 0 && check.issues.length === 0
  const samples = compatibleSamples(required)

  // Text filters that can't match anything in this file (the recipe is fine; the data differs).
  const hints =
    check?.kind === 'ok'
      ? def.steps.flatMap((step) => {
          if (step.type !== 'filter' || step.operator !== 'eq') return []
          const present = check.valuesByColumn[step.column]
          if (!present) return []
          const isParam = 'parameter' in step.value
          const literal = isParam ? values[(step.value as { parameter: string }).parameter] ?? '' : (step.value as { literal: string | number }).literal
          if (typeof literal !== 'string') return []
          const found = literalMismatch(step.column, literal, present)
          return found ? [{ ...found, parameter: isParam ? (step.value as { parameter: string }).parameter : null }] : []
        })
      : []
  // An error from running another version is not about the version on screen.
  const runError = run.variables?.versionId === versionId ? run.error : null
  const error = runError instanceof ApiError ? runError : runError ? new ApiError(0, 'ERROR', runError.message) : null

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
        {!file && samples.length > 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span>No file handy? Try</span>
            {samples.map((sample) => (
              <button
                key={sample.name}
                type="button"
                onClick={async () => onFile(await fetchSample(sample.name))}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 hover:border-flow/50 hover:text-flow-ink"
              >
                <FileSpreadsheet className="size-3" aria-hidden /> {sample.name}
              </button>
            ))}
          </div>
        )}

        {file && !check && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
            <Spinner className="size-3.5" /> Checking the file against v{detail.version.number}…
          </p>
        )}
        {check?.kind === 'error' && (
          <Callout tone="bad">
            <p>{check.message}</p>
            {check.issues[0]?.line !== undefined && <p className="mt-1 text-[12.5px]">{check.issues[0].message}</p>}
          </Callout>
        )}
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
            {check.missingMessage && <p className="mt-2 text-bad-ink">{check.missingMessage}</p>}
            {check.ignored.length > 0 && (
              <p className="mt-2 text-muted">
                Ignored (not used, never stored): <span className="font-mono">{check.ignored.join(', ')}</span>
              </p>
            )}
            {check.issues.length > 0 && (
              <div className="mt-2.5 rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-bad-ink" role="alert">
                <p className="font-medium">{check.issueSummary} Fix these lines, then choose the file again:</p>
                <ul className="mt-1 max-h-36 list-disc space-y-0.5 overflow-y-auto pl-4">
                  {check.issues.map((issue, i) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {hints.map((hint, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink" role="status">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">In this file, {hint.message} The run would match nothing at this step.</span>
            {hint.parameter && hint.suggestion && (
              <Button size="sm" onClick={() => setValues((prev) => ({ ...prev, [hint.parameter!]: hint.suggestion! }))}>
                Use “{hint.suggestion}”
              </Button>
            )}
          </div>
        ))}

        {relativeDates && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="run-as-of" className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
                <CalendarDays className="size-3.5" aria-hidden /> As of
              </label>
              {asOf !== todayIso() && (
                <button type="button" onClick={() => setAsOf(todayIso())} className="inline-flex items-center gap-1 text-[12px] text-brand-ink hover:underline">
                  <RotateCcw className="size-3" /> Reset to today
                </button>
              )}
            </div>
            <Input id="run-as-of" type="date" value={asOf} aria-invalid={asOfOk ? undefined : true} onChange={(e) => setAsOf(e.target.value)} />
            <p className={cn('mt-1 text-[12px]', asOfOk ? 'text-muted' : 'text-bad-ink')}>
              {asOfOk ? `This recipe counts “last month” and “N days ago” from this day (${formatDate(asOf)}); it is saved with the run.` : 'A date like 2026-04-03'}
            </p>
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
              const preview = p.type === 'integer' && /^\d+$/.test(value.trim()) ? formatParameterValue(Number(value), units[name]) : null
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
                        <RotateCcw className="size-3" /> Reset to {formatParameterValue(p.default, units[name])}
                      </button>
                    )}
                  </div>
                  <Input
                    id={`param-${name}`}
                    type={p.type === 'date' ? 'date' : undefined}
                    inputMode={p.type === 'integer' ? 'numeric' : undefined}
                    value={value}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                  <p className={cn('mt-1 text-[12px]', problem ? 'text-bad-ink' : 'text-muted')}>
                    {problem ??
                      (p.type === 'integer'
                        ? `${preview ?? 'Default'} · allowed ${formatParameterValue(p.min, units[name])}–${formatParameterValue(p.max, units[name])}`
                        : p.type === 'date'
                          ? `Default ${formatDate(p.default)}`
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
          disabled={!fileOk || !paramsOk || busy || !detail.permissions.run.allowed}
          onClick={() => run.mutate({ versionId })}
        >
          {!detail.permissions.run.allowed ? 'Archived: can’t run' : file ? 'Run recipe' : 'Choose a file to run'}
        </Button>
        <p className="text-center text-[11.5px] text-faint">Your file is processed in this request and never stored.</p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Where the numbers came from, for the second sheet of the Excel download. */
function aboutRun(r: RunDetail, title: string): Array<[string, string]> {
  return [
    ['Recipe', title],
    ['Version', `v${r.versionNumber}`],
    ['Run at', new Date(r.createdAt).toLocaleString()],
    ['Input file', `${r.inputName ?? 'file'}${r.inputRows !== null ? ` · ${formatCount(r.inputRows)} rows read` : ''}`],
    ['Parameters', r.parametersText || 'none'],
    ['Result', r.summary ?? ''],
    ['Rows', formatCount(r.rows.length)],
    ['Link', `${window.location.origin}/w/${r.workflowId}?v=${r.versionId}&run=${r.id}`],
    ['Made with', 'FlowPilot: a deterministic run of the saved recipe, no AI involved'],
  ]
}

function ResultCard({ runId, detail, onClose }: { runId: string; detail: WorkflowDetail; onClose: () => void }) {
  const run = useQuery({ queryKey: qk.run(runId), queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`) })
  const ranOnOther = !!run.data && run.data.versionId !== detail.version.id
  const ranVersion = useQuery({
    queryKey: qk.workflow(detail.workflow.id, run.data?.versionId),
    queryFn: () => api.get<WorkflowDetail>(`/api/workflows/${detail.workflow.id}${qs({ v: run.data!.versionId })}`),
    enabled: ranOnOther,
  })
  const definition = ranOnOther ? ranVersion.data?.version.definition : detail.version.definition
  const toast = useToast()
  const [exporting, setExporting] = React.useState(false)

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
  if (r.workflowId !== detail.workflow.id) {
    return (
      <Callout
        tone="info"
        title="That result belongs to another recipe"
        action={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Dismiss
          </Button>
        }
      >
        {r.recipeAvailable ? (
          <>
            It was a run of{' '}
            <Link to="/w/$workflowId" params={{ workflowId: r.workflowId }} search={{ run: r.id, v: r.versionId }} className="font-medium underline">
              {r.workflowTitle}
            </Link>
            .
          </>
        ) : (
          'The recipe it came from is no longer available to you; the result is still listed under My runs.'
        )}
      </Callout>
    )
  }
  const params = Object.entries(r.parameters)
  const units = definition ? parameterUnits(definition) : {}
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
              <>
                <a href={`/api/runs/${r.id}/csv`} download className={buttonClass('secondary', 'sm')}>
                  <Download className="size-3.5" /> CSV
                </a>
                <Button
                  size="sm"
                  icon={<FileSpreadsheet className="size-3.5" />}
                  loading={exporting}
                  onClick={async () => {
                    setExporting(true)
                    try {
                      const blob = await resultWorkbook({ columns: r.columns, rows: r.rows, about: aboutRun(r, detail.workflow.title) })
                      saveBlob(blob, exportFileName(detail.workflow.title, r.versionNumber, r.createdAt))
                    } catch (err) {
                      toast.show({ tone: 'bad', title: 'Could not build the Excel file', description: err instanceof Error ? err.message : String(err) })
                    } finally {
                      setExporting(false)
                    }
                  }}
                >
                  Excel
                </Button>
              </>
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
                <code className="text-ink-2">{name}</code> = <span className="tabular font-medium text-ink-2">{formatParameterValue(value, units[name])}</span>
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
    queryFn: () => api.get<RunList>(`/api/runs${qs({ workflowId })}`),
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
                      {r.parametersText && <span className="block truncate text-[12px] text-muted">{r.parametersText}</span>}
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
