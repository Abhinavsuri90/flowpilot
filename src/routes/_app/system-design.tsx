import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  Braces,
  Database,
  GitBranch,
  Layers,
  ListOrdered,
  Network,
  Scale,
  Server,
  Sparkles,
  Timer,
  Zap,
} from 'lucide-react'
import { api, qk } from '~/lib/api'
import { formatCount, formatINR } from '~/lib/format'
import type { SystemInfo } from '~/lib/types'
import { Badge, Card, CardHeader, PageHeader, Segmented, Skeleton, cn } from '~/components/ui'
import { ArchitectureDiagram, PathLegend, type PathView } from '~/components/diagrams/architecture'
import { VersioningDiagram } from '~/components/diagrams/versioning'

export const Route = createFileRoute('/_app/system-design')({
  head: () => ({ meta: [{ title: 'System design · FlowPilot' }] }),
  component: SystemDesign,
})

const SECTIONS = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'lifecycle', label: 'Pressing Run' },
  { id: 'ai', label: 'AI authoring' },
  { id: 'versions', label: 'Versions & forks' },
  { id: 'schema', label: 'Live schema' },
  { id: 'limits', label: 'Limits' },
  { id: 'failures', label: 'Failure modes' },
  { id: 'scaling', label: 'Scaling path' },
  { id: 'tradeoffs', label: 'Trade-offs' },
  { id: 'stack', label: 'Tech stack' },
]

function SystemDesign() {
  const system = useQuery({ queryKey: qk.system, queryFn: () => api.get<SystemInfo>('/api/system') })
  return (
    <>
      <PageHeader
        eyebrow="Architecture"
        title="System design"
        description="AI drafts the recipe; a deterministic server executes it; one access policy guards every request. Everything below the fold is read live from this running system."
      />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0 space-y-6">
          <ArchitectureSection />
          <LifecycleSection />
          <AiSection system={system.data} />
          <VersionsSection />
          <SchemaSection system={system.data} loading={system.isPending} error={system.error} />
          <LimitsSection system={system.data} />
          <FailuresSection />
          <ScalingSection />
          <TradeoffsSection />
          <StackSection system={system.data} />
        </div>
        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-24 space-y-1 border-l border-line pl-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">On this page</div>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block py-0.5 text-[13px] text-muted hover:text-ink">
                {s.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </>
  )
}

function Section({ id, icon, title, description, children }: { id: string; icon: React.ReactNode; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="animate-rise">
        <CardHeader icon={icon} title={title} description={description} />
        <div className="px-5 pb-5">{children}</div>
      </Card>
    </section>
  )
}

function Table({ head, rows, className }: { head: string[]; rows: React.ReactNode[][]; className?: string }) {
  return (
    <div className={cn('scrollbar-thin relative overflow-x-auto rounded-xl border border-line', className)}>
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="bg-surface-2 text-left text-[12px] text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3.5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line align-top">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-3.5 py-2.5', j === 0 ? 'font-medium text-ink' : 'text-ink-2')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const code = (s: string) => <code className="rounded bg-sunken px-1 py-0.5 text-[12px] text-ink">{s}</code>

// ----- Architecture ---------------------------------------------------------------------

function ArchitectureSection() {
  const [view, setView] = React.useState<PathView>('both')
  return (
    <Section
      id="architecture"
      icon={<Network />}
      title="Two paths, one policy"
      description="Only the dispatcher, the access policy and the validator sit on both paths. The model provider is never on the execution path, so a saved recipe runs even when AI is down."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Highlight a path"
          value={view}
          onChange={setView}
          items={[
            { value: 'both', label: 'Both' },
            { value: 'authoring', label: 'Authoring', icon: <Sparkles /> },
            { value: 'execution', label: 'Execution', icon: <Zap /> },
          ]}
        />
        <PathLegend />
      </div>
      <ArchitectureDiagram view={view} />
      <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
        {view === 'execution'
          ? 'A run goes through the policy, the validator (which re-checks the stored version), the CSV parser and the engine, and ends in a private run record. No model client is imported anywhere on this path.'
          : view === 'authoring'
            ? 'The model sees column names and types, never rows. It returns a schema-constrained draft that the server validates independently; a person reviews it, and only a save writes a new version.'
            : 'Every request, from either path, passes through one dispatcher that checks the origin, resolves the session and maps errors to one JSON shape.'}
      </p>
      <Table
        className="mt-4"
        head={['Module', 'Responsibility']}
        rows={[
          [code('lib/workflow/schema.ts'), 'Recipe types, limits, strict Zod schema'],
          [code('lib/workflow/validate.ts'), 'Structural + semantic validation, column tracking step by step, parameter resolution'],
          [code('lib/workflow/execute.ts'), 'Allowlisted filter and group_sum, 30 s deadline, step log'],
          [code('lib/workflow/describe.ts'), 'Plain-language steps and the deterministic summary line'],
          [code('lib/csv.ts'), 'Parsing, limits, whole-rupee amounts, type inference, formula-safe export'],
          [code('lib/policy.ts'), 'Pure access policy shared by the server and the Access page'],
          [code('server/api/router.ts'), 'Single dispatcher: route match, origin check, session, error mapping'],
          [code('server/repo.ts'), 'Access-aware queries, versions, forks, runs, stale-run reaper'],
          [code('server/ai/generate.ts'), 'One model call, output schema, one repair, provider adapters'],
          [code('server/events.ts'), 'Append-only audit log and the permission-filtered activity feed'],
        ]}
      />
    </Section>
  )
}

// ----- Lifecycle --------------------------------------------------------------------------

const LIFECYCLE: Array<[string, string, string]> = [
  ['Route and origin', 'The dispatcher matches the route; a write whose Origin differs from the host is blocked', '403 BAD_ORIGIN'],
  ['Session', 'Hash the cookie token, load the session and the user (roles are read fresh)', '401'],
  ['Size guard', 'Reject bodies above 1 MiB plus form overhead while reading, before parsing', '413'],
  ['Authorize', 'Load version → recipe → caller’s role; decide("run"). Done before the file is read', '404'],
  ['Re-validate recipe', 'The stored definition goes through the strict validator again', '422 DEFINITION_INVALID'],
  ['Parameters', 'Values checked against type and min/max; defaults fill gaps; unknown names rejected', '422 PARAMETERS_INVALID'],
  ['Parse file', 'BOM, headers, duplicates, field counts, limits, required columns, whole-rupee amounts; extras dropped', '413 / 422 INVALID_FILE (≤20 line-numbered issues)'],
  ['Record', 'Insert a running row that pins version, runner and parameters', '—'],
  ['Execute', 'filter / group_sum as plain functions; deadline checked between steps and every 1,024 rows', '500 TIMEOUT · EXECUTION_ERROR (row finalised as failed)'],
  ['Finalize', 'Store result, step log, summary, row count and duration; append a run.succeeded event', '—'],
  ['Respond', '201 with columns, rows, summary, step log and ignored columns; private, no-store', '—'],
]

function LifecycleSection() {
  return (
    <Section
      id="lifecycle"
      icon={<ListOrdered />}
      title="Request lifecycle: pressing Run"
      description={
        <>
          {code('POST /api/runs')} does all its work inside one request as plain function calls. Cheap checks run first; nothing is written
          until the input is proven valid.
        </>
      }
    >
      <ol className="space-y-2">
        {LIFECYCLE.map(([step, what, failure], i) => (
          <li key={step} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 sm:grid-cols-[28px_150px_minmax(0,1fr)_minmax(0,220px)] sm:items-start">
            <span className="grid size-7 place-items-center rounded-full bg-flow-soft text-[12px] font-semibold text-flow-ink">{i + 1}</span>
            <span className="pt-1 text-[13.5px] font-semibold text-ink">{step}</span>
            <span className="col-start-2 text-[13px] text-muted sm:col-start-auto sm:pt-1">{what}</span>
            <span className="col-start-2 sm:col-start-auto sm:pt-0.5">
              {failure === '—' ? (
                <span className="text-[12.5px] text-faint">—</span>
              ) : (
                <Badge tone={failure.startsWith('4') ? 'warn' : 'bad'} className="!whitespace-normal">
                  {failure}
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] text-muted">
        If the process dies between steps 8 and 10, the run stays {code('running')}. Any read of runs marks rows older than 60 seconds as
        failed with {code('STALE')}, so no run spins forever.
      </p>
    </Section>
  )
}

// ----- AI authoring ------------------------------------------------------------------------

function AiSection({ system }: { system?: SystemInfo }) {
  return (
    <Section
      id="ai"
      icon={<Sparkles />}
      title="AI authoring"
      description="The model only proposes parameters and steps for columns the author already declared. It never saves and never runs anything."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">What the model receives</h3>
          <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
            <li>• The user’s sentence (3 to 2,000 characters)</li>
            <li>• Declared column names and types: text or amount (whole INR). Never data rows</li>
            <li>• The two operations, their operators, and the rule that group_sum keeps only two columns</li>
            <li>• When to answer “unsupported” (email, Gmail, Slack, APIs, scheduling, joins, charts, averages, code, SQL) or ask one clarification question</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">The loop</h3>
          <ol className="mt-2 space-y-1.5 text-[13px] text-muted">
            <li>1. One call with a 20-second timeout; the reply must match a strict, flat JSON schema</li>
            <li>2. Anthropic: forced {code('submit_recipe')} tool call · OpenAI and OpenRouter: {code('json_schema')} strict</li>
            <li>3. The server wraps the steps with the author’s own input contract and runs the full validator</li>
            <li>4. If invalid, the errors go back exactly once; still invalid → 422 DRAFT_INVALID with the draft</li>
            <li>5. No key, provider error or timeout → 503 MODEL_UNAVAILABLE; manual editing and saved recipes keep working</li>
          </ol>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        Model on this server:
        {system ? (
          system.model.available ? (
            <Badge tone="ai" icon={<Sparkles />}>
              {system.model.provider} · {system.model.model}
            </Badge>
          ) : (
            <Badge tone="neutral">not configured (manual editing only)</Badge>
          )
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
      </div>
    </Section>
  )
}

// ----- Versions ----------------------------------------------------------------------------

function VersionsSection() {
  return (
    <Section
      id="versions"
      icon={<GitBranch />}
      title="Versions, runs and forks"
      description="Saving never edits a version: it appends the next one and moves the recipe’s current pointer. Runs pin the exact version they executed, and a copy points back at one version."
    >
      <VersioningDiagram />
      <Table
        className="mt-4"
        head={['Action', 'Writes', 'Never touches']}
        rows={[
          ['Save (owner)', <>New {code('workflow_versions')} row + {code('current_version_id')}</>, 'Earlier versions, runs'],
          ['Run (anyone who can view)', <>One {code('runs')} row: running → succeeded or failed</>, 'The recipe, other people’s runs'],
          ['Change a parameter for a run', code('runs.parameters'), 'The recipe’s defaults'],
          ['Make a copy (admin or member who can view)', <>New private {code('workflows')} row + its version 1</>, 'The source recipe, its runs, its sharing'],
          ['Share / unshare (owner)', code('workflows.visibility'), 'Copies already made'],
        ]}
      />
    </Section>
  )
}

// ----- Live schema -------------------------------------------------------------------------

function SchemaSection({ system, loading, error }: { system?: SystemInfo; loading: boolean; error: Error | null }) {
  return (
    <Section
      id="schema"
      icon={<Database />}
      title="Live schema and triggers"
      description="Read from this server’s SQLite database right now: structure only, never rows. Triggers enforce the invariants no code path can bypass."
    >
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : error || !system ? (
        <p className="text-[13px] text-muted">The live schema could not be loaded.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="flow">SQLite {system.runtime.sqlite}</Badge>
            <Badge tone="flow">journal_mode = {system.runtime.journalMode}</Badge>
            <Badge tone={system.runtime.foreignKeys ? 'ok' : 'warn'}>foreign_keys = {system.runtime.foreignKeys ? 'ON' : 'OFF'}</Badge>
            <Badge tone="neutral">{system.triggers.length} triggers</Badge>
            <Badge tone="neutral">{system.indexes.length} indexes</Badge>
            <Badge tone="neutral">
              {system.migrations.length} migration{system.migrations.length === 1 ? '' : 's'} applied
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {system.tables.map((t) => {
              const triggers = system.triggers.filter((tr) => tr.table === t.name)
              return (
                <div key={t.name} className="rounded-xl border border-line bg-surface-2 p-3.5">
                  <div className="flex items-center justify-between">
                    <code className="text-[13px] font-semibold text-ink">{t.name}</code>
                    <span className="text-[11.5px] text-faint">{t.columns.length} columns</span>
                  </div>
                  <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
                    {t.columns.map((c) => (
                      <li key={c.name} className="flex items-center gap-1.5 text-[12px]">
                        <span className={cn('truncate font-mono', c.primaryKey ? 'font-semibold text-brand-ink' : 'text-ink-2')}>{c.name}</span>
                        <span className="text-faint">{c.type.toLowerCase()}</span>
                        {c.primaryKey && <span className="rounded bg-brand-soft px-1 text-[10px] font-semibold text-brand-ink">PK</span>}
                      </li>
                    ))}
                  </ul>
                  {triggers.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1 border-t border-line pt-2.5">
                      {triggers.map((tr) => (
                        <span key={tr.name} className="rounded-md bg-warn-soft px-1.5 py-0.5 font-mono text-[10.5px] text-warn-ink" title="Trigger">
                          {tr.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <details className="group mt-4 rounded-xl border border-line">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[13.5px] font-medium text-ink">
              <span className="inline-flex items-center gap-2">
                <Braces className="size-4 text-muted" /> REST API: {system.endpoints.length} endpoints behind one dispatcher
              </span>
              <span className="text-[12px] text-muted group-open:hidden">Show</span>
            </summary>
            <ul className="grid gap-1.5 border-t border-line px-4 py-3 sm:grid-cols-2">
              {system.endpoints.map((e) => (
                <li key={`${e.method} ${e.pattern}`} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className={cn(
                      'w-14 rounded-md px-1.5 py-0.5 text-center font-mono text-[10.5px] font-semibold',
                      e.method === 'GET' ? 'bg-flow-soft text-flow-ink' : e.method === 'DELETE' ? 'bg-bad-soft text-bad-ink' : 'bg-brand-soft text-brand-ink',
                    )}
                  >
                    {e.method}
                  </span>
                  <code className="text-ink-2">{e.pattern}</code>
                  {!e.auth && <span className="text-[11px] text-faint">public</span>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Section>
  )
}

// ----- Limits ----------------------------------------------------------------------------------

function LimitsSection({ system }: { system?: SystemInfo }) {
  const l = system?.limits
  const rows: React.ReactNode[][] = l
    ? [
        ['File size', '1 MiB', '413 · request guard and CSV parser'],
        ['Rows per file', formatCount(l.rows!), '422 · CSV parser'],
        ['Columns per file', String(l.columns), '422 · CSV parser'],
        ['Steps per recipe', String(l.steps), '422 · validator'],
        ['Amount per row', `${formatINR(l.amountMax!)} (whole rupees, no decimals, no separators)`, '422 · CSV parser'],
        ['Integer parameter', `0 to ${formatINR(l.integerParameterMax!)}`, '422 · validator'],
        ['Text value', `${l.textMax} characters`, '422 · validator'],
        ['Execution deadline', `${l.deadlineMs! / 1000} s`, '500 TIMEOUT'],
        ['Stale run', `${l.staleRunMs! / 1000} s`, 'reported as failed STALE'],
        ['Model call', `${l.modelTimeoutMs! / 1000} s`, '503 MODEL_UNAVAILABLE'],
      ]
    : []
  return (
    <Section
      id="limits"
      icon={<Timer />}
      title="Limits"
      description="Prototype design limits, not measured guarantees. The largest possible total (5,000 rows × ₹1 crore) is 5 × 10¹⁰, well inside JavaScript’s exact-integer range, so sums are exact."
    >
      {l ? <Table head={['Limit', 'Value', 'Enforced by']} rows={rows} /> : <Skeleton className="h-60" />}
    </Section>
  )
}

// ----- Failure modes -------------------------------------------------------------------------

function FailuresSection() {
  return (
    <Section id="failures" icon={<AlertTriangle />} title="Failure modes" description="Every failure has a defined outcome the user can read, and none can corrupt a stored recipe or another person’s data.">
      <Table
        head={['Failure', 'Detection', 'What the user sees']}
        rows={[
          ['Model provider down, slow or no key', 'HTTP error, 20 s abort, or missing config', '503 “AI generation is unavailable… saved recipes still run”; manual editing works'],
          ['Model returns an invalid draft', 'Zod + validator after one repair', '422 with the draft loaded into the editor and errors on each step card'],
          ['Unsupported request (“email this via Gmail every Monday”)', 'Model answers unsupported', 'A callout with the reason; no writes, no pretend integration'],
          ['Ambiguous column in the request', 'Model answers clarification', 'One question to answer before generating again'],
          ['Missing column, bad amounts, duplicate headers', 'CSV parser', <>422 with up to 20 line-numbered issues, e.g. {code('Line 6, amount: "60,000" contains separators')}</>],
          ['File too large or too many rows', 'Size guard and parser', '413 or 422 naming the limit'],
          ['Run parameter out of bounds', 'Parameter resolver', '422 PARAMETERS_INVALID naming the allowed range'],
          ['Recipe made private mid-session', 'Policy on every request', '404 on the recipe; existing copies keep working'],
          ['Execution exceeds 30 s', 'Deadline checks in the engine', 'Run stored as failed TIMEOUT'],
          ['Process crash mid-run', 'running row older than 60 s', 'Reported as failed STALE in history'],
          ['Zero matching rows', 'Engine returns an empty table', '“No rows matched” with a hint; never placeholder data'],
          ['Someone edits a recipe you’re viewing', 'Versions are immutable', 'Your pinned version keeps working; a banner says “Version N (latest is M)”'],
        ]}
      />
    </Section>
  )
}

// ----- Scaling ------------------------------------------------------------------------------------

function ScalingSection() {
  return (
    <Section
      id="scaling"
      icon={<Scale />}
      title="Scaling path"
      description="Each simple choice has a known next step. The contracts that matter don’t change as it grows: the recipe format, the policy functions and the API shape."
    >
      <Table
        head={['Concern', 'Today (prototype)', 'Next (first real teams)', 'At scale']}
        rows={[
          ['Storage', 'SQLite (WAL) + triggers, one file', 'Postgres with row-level security mirroring lib/policy.ts; RPC functions for multi-row writes', 'Read replicas; partition runs by month; archive old results'],
          ['Execution', 'In-request, ≤ 5,000 rows, 30 s', 'Job queue + workers; inputs in object storage with a short TTL; progress polling', 'Columnar engine (e.g. DuckDB) streaming large files; autoscaled pool'],
          ['Identity', 'Email + password, session table', 'SSO / OIDC; sessions in Redis; invitations', 'SCIM provisioning; per-workspace policies; audit export'],
          ['Sharing', 'Private or workspace-wide', 'Named groups; column mapping when headers differ', 'Cross-workspace publishing with review'],
          ['AI authoring', 'One call + one repair', 'Cache by hash(request, schema); offline eval set', 'Per-tenant model config, budgets, AI-assisted copies with diffs'],
          ['Rate limits', 'In-memory login throttle', 'Redis token buckets per user and workspace', 'Edge rate limiting and abuse detection'],
          ['Observability', 'Audit events + console logs', 'Structured logs, OpenTelemetry traces', 'SLOs on run latency (p95) and failure rate, with alerts'],
          ['Integrations', 'None (CSV upload only)', 'One spreadsheet source, bound per runner, never the author’s account', 'Adapter to an execution backend (e.g. n8n) for a validated subset'],
        ]}
      />
      <p className="mt-3 text-[13px] text-muted">
        The first two changes when real users arrive: Postgres with row-level security (a second enforcement layer beneath the API) and a
        queue for execution (durability beyond one request).
      </p>
    </Section>
  )
}

// ----- Trade-offs ---------------------------------------------------------------------------------

function TradeoffsSection() {
  return (
    <Section id="tradeoffs" icon={<Layers />} title="Trade-offs" description="Each decision buys reliability or simplicity, at a cost that is stated rather than hidden.">
      <Table
        head={['Decision', 'Gain', 'Cost']}
        rows={[
          ['Linear steps, not a graph', 'Simple to validate, render as cards and explain', 'No branches, joins or loops'],
          ['Deterministic engine, not an LLM runtime', 'Reproducible, auditable, cheap; runs with the model offline', 'Only what two operations can express'],
          ['Schema-only prompts', 'No customer rows leave the server; small prompts', 'The model can’t see value casing (“Paid” vs “paid”)'],
          ['Immutable versions', 'Runs and pinned links stay reproducible', 'More rows; every edit is a new version'],
          ['Copy, not reference', 'A copy never breaks when the source changes or goes private', 'Copies don’t receive upstream fixes'],
          ['Synchronous execution', 'No queue to operate; results in the same request', 'Bounded to small files; needs the stale-run rule'],
          ['404 for anything you can’t see', 'Ids can’t be probed for existence', 'Slightly less specific errors for people without access'],
          ['Viewer role can run but not copy', 'Teams can share reports with read-only colleagues', 'One more role to explain'],
          ['SQLite + triggers', 'Zero setup; invariants still enforced in the database', 'Single writer, single node; Postgres + RLS is the production path'],
          ['Strict whole-rupee amounts', 'No silent rounding or blank-as-zero', 'Files with decimals or “60,000” must be cleaned first'],
        ]}
      />
      <p className="mt-3 text-[13px] text-muted">
        Where this sits: workflow builders such as n8n already offer natural-language building, templates and sharing. FlowPilot’s bet is
        narrower: a business-facing library of file-based recipes with declared inputs, safe reuse and independent adaptation, measured by
        other people’s successful repeat runs.
      </p>
    </Section>
  )
}

// ----- Stack -----------------------------------------------------------------------------------------

function StackSection({ system }: { system?: SystemInfo }) {
  return (
    <Section id="stack" icon={<Boxes />} title="Tech stack" description="TanStack end to end: one TypeScript codebase serves the pages and the REST API, and needs no external services to run locally.">
      <Table
        head={['Layer', 'Choice', 'Why']}
        rows={[
          ['Framework', 'TanStack Start (React 19, Vite, Nitro)', 'SSR pages and server routes in one app; server functions for the session check'],
          ['Routing', 'TanStack Router, file-based', 'Typed params and search params (?v=, ?run=, ?tab=); auth guard in the _app layout'],
          ['Server state', 'TanStack Query', 'Per-user cache, targeted invalidation after share, fork, save and run'],
          ['Tables', 'TanStack Table v9 (useTable + sorting feature)', 'Sortable result grid and run history'],
          ['Styling', 'Tailwind CSS v4 with CSS-variable tokens', 'Light and dark themes from one token set'],
          ['Validation', 'Zod 4, strict', 'Unknown keys rejected; one schema for browser, model output and server'],
          ['CSV', 'Papa Parse', 'Our own header handling; escapeFormulae on export'],
          ['Database', 'SQLite via better-sqlite3 (WAL)', 'Zero setup; triggers enforce invariants'],
          ['Auth', 'Email + password, scrypt, session table, HttpOnly cookie', 'Real multi-user sessions, no third-party dependency'],
          ['AI', 'Anthropic (forced tool call), OpenAI or OpenRouter (strict json_schema)', 'Structured output; provider picked by environment variables'],
          ['Tests', 'Vitest + Playwright', 'Engine, CSV, validator, access, demo loop and AI against a real database; a browser walkthrough'],
        ]}
      />
      {system && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          <Server className="size-3.5" /> Running on Node {system.runtime.node} with SQLite {system.runtime.sqlite}.
        </p>
      )}
    </Section>
  )
}
