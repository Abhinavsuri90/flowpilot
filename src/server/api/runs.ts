import { ApiError, invalid, json, NO_STORE, notFound, readBodyCapped } from '../http'
import {
  countRuns,
  deleteFinishedRuns,
  finishRunFailed,
  finishRunSucceeded,
  getRun,
  getVersion,
  getWorkflow,
  insertRun,
  listRuns,
  reapStaleRuns,
  relationTo,
  toRunDetail,
  toRunSummary,
} from '../repo'
import { recordEvent } from '../events'
import { workspaceTimeZone } from '../accounts'
import { log, metrics } from '../observability'
import { canReadRun, decide } from '../../lib/policy'
import { CsvError, parseForContract, toCsv } from '../../lib/csv'
import { execute, ExecutionError } from '../../lib/workflow/execute'
import { AS_OF_KEY, summarize } from '../../lib/workflow/describe'
import { isIsoDate, todayIn, usesRelativeDates } from '../../lib/dates'
import { resolveParameters, validateDefinition } from '../../lib/workflow/validate'
import { LIMITS } from '../../lib/workflow/schema'
import type { RunDetail, RunList, RunStatus } from '../../lib/types'
import type { AuthedContext } from './context'

/** Multipart overhead allowed on top of the 1 MiB file. */
const FORM_OVERHEAD = 64 * 1024

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload.csv'
  // Keep it printable and short; it's only ever rendered as text.
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'upload.csv'
}

/**
 * POST /api/runs: everything happens inside this one request as plain function
 * calls. Cheap checks run first, and nothing is written until the input is valid.
 */
export async function create({ db, user, request }: AuthedContext): Promise<Response> {
  // 1. Content type
  const type = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data\b/i.test(type)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the file as multipart/form-data.')
  }
  // 2. Size guard (Content-Length and the actual bytes read)
  const bytes = await readBodyCapped(request, LIMITS.fileBytes + FORM_OVERHEAD)
  let form: FormData
  try {
    form = await new Response(bytes, { headers: { 'content-type': type } }).formData()
  } catch {
    throw invalid('The upload could not be read. Send the file and fields as multipart/form-data.')
  }

  // 3–4. Load the version and authorize before touching the file.
  const versionId = form.get('versionId')
  if (typeof versionId !== 'string' || !versionId) throw invalid('Choose which version to run (versionId is required).')
  const version = getVersion(db, versionId)
  const wf = version ? getWorkflow(db, version.workflow_id) : undefined
  if (!version || !wf) throw notFound('That recipe')
  const rel = relationTo(db, user, wf)
  if (!decide('run', rel, wf.visibility).allowed) throw notFound('That recipe')
  if (wf.archived_at) throw new ApiError(409, 'RECIPE_ARCHIVED', 'This recipe is archived. Its owner can restore it to run it again.')

  // 5. The file
  const file = form.get('file')
  if (!(file instanceof File)) throw invalid('Attach a CSV file to run the recipe on.')
  if (file.size > LIMITS.fileBytes) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file is larger than the 1 MiB limit.')

  // 6. Parameters JSON
  let provided: unknown = {}
  const rawParams = form.get('parameters')
  if (typeof rawParams === 'string' && rawParams.trim()) {
    try {
      provided = JSON.parse(rawParams)
    } catch {
      throw invalid('Parameters must be a JSON object.', undefined, 'PARAMETERS_INVALID')
    }
  }

  // 6b. The day relative dates ("last month", "30 days ago") count from: today in the
  // recipe's workspace (its calendar, not the server's), unless the runner says otherwise
  const rawAsOf = form.get('asOf')
  let asOf = todayIn(workspaceTimeZone(db, wf.workspace_id))
  if (typeof rawAsOf === 'string' && rawAsOf.trim()) {
    if (!isIsoDate(rawAsOf.trim())) {
      throw invalid('asOf must be a date like 2026-04-03.', [{ path: 'asOf', message: 'asOf must be a date like 2026-04-03' }], 'PARAMETERS_INVALID')
    }
    asOf = rawAsOf.trim()
  }

  // 7. Re-validate the stored definition
  const validation = validateDefinition(JSON.parse(version.definition))
  if (!validation.ok) {
    throw invalid('This version of the recipe is not valid and cannot run.', validation.issues, 'DEFINITION_INVALID')
  }
  const def = validation.definition

  // 8. Resolve parameters (defaults fill gaps; the recipe is never changed)
  const params = resolveParameters(def, provided)
  if (!params.ok) throw invalid(params.issues[0]!.message, params.issues, 'PARAMETERS_INVALID')

  // 9. Parse the file against the input contract
  let parsed: ReturnType<typeof parseForContract>
  try {
    parsed = parseForContract(new Uint8Array(await file.arrayBuffer()), def.input.columns)
  } catch (err) {
    if (err instanceof CsvError) throw new ApiError(err.status, err.code, err.message, { issues: err.issues })
    throw err
  }

  // 10. Record a running row that pins version, runner and parameters (plus the as-of day when it matters)
  const runId = insertRun(db, {
    versionId: version.id,
    workflowId: wf.id,
    runnerId: user.id,
    parameters: usesRelativeDates(def) ? { ...params.values, [AS_OF_KEY]: asOf } : params.values,
    inputName: cleanFileName(file.name),
    inputRows: parsed.rows.length,
  })

  // 11–12. Execute and finalize
  const started = performance.now()
  const elapsed = () => Math.round((performance.now() - started) * 100) / 100
  try {
    const result = execute(def, parsed.rows, params.values, { asOf })
    const summary = summarize(def, params.values, result.rows.length, asOf)
    finishRunSucceeded(db, runId, {
      result: { columns: result.columns, rows: result.rows, ignoredColumns: parsed.ignoredColumns },
      stepLog: result.stepLog,
      summary,
      rowCount: result.rows.length,
      durationMs: elapsed(),
    })
    metrics.runs.inc({ status: 'succeeded' })
    metrics.runDuration.observe({}, elapsed() / 1000)
  } catch (err) {
    const code = err instanceof ExecutionError ? err.code : 'EXECUTION_ERROR'
    const message = err instanceof ExecutionError ? err.message : 'The run failed unexpectedly.'
    if (!(err instanceof ExecutionError)) log('error', 'run failed unexpectedly', { runId, err })
    finishRunFailed(db, runId, { code, message, durationMs: elapsed() })
    metrics.runs.inc({ status: 'failed' })
    metrics.runDuration.observe({}, elapsed() / 1000)
    recordEvent(db, { workspaceId: wf.workspace_id, actorId: user.id, type: 'run.failed', workflowId: wf.id, detail: { runId, versionNumber: version.version_number } })
    throw new ApiError(500, code, message, { runId })
  }

  // 13–14. Event, then the private result
  recordEvent(db, {
    workspaceId: wf.workspace_id,
    actorId: user.id,
    type: 'run.succeeded',
    workflowId: wf.id,
    detail: { runId, versionNumber: version.version_number },
  })
  const body: RunDetail = toRunDetail(db, user, getRun(db, runId)!)
  return json(body, { status: 201 })
}

const RUN_STATUSES = new Set<RunStatus>(['running', 'succeeded', 'failed'])

export function list({ db, user, url }: AuthedContext): Response {
  reapStaleRuns(db)
  const workflowId = url.searchParams.get('workflowId') || undefined
  const statusParam = url.searchParams.get('status') as RunStatus | null
  const status = statusParam && RUN_STATUSES.has(statusParam) ? statusParam : undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam && /^\d{1,9}$/.test(limitParam) ? Number(limitParam) : undefined
  const runs = listRuns(db, user.id, { workflowId, status, limit }).map((run) => toRunSummary(db, user, run))
  const body: RunList = { runs, counts: countRuns(db, user.id, { workflowId }) }
  return json(body)
}

function loadOwnRun({ db, user, params }: AuthedContext) {
  reapStaleRuns(db)
  const run = getRun(db, params.id!)
  // Runs are private to their runner, even from the recipe owner and admins.
  if (!run || !canReadRun(run.runner_id, user.id)) throw notFound('That run')
  return run
}

export function detail(ctx: AuthedContext): Response {
  return json(toRunDetail(ctx.db, ctx.user, loadOwnRun(ctx)))
}

export function csv(ctx: AuthedContext): Response {
  const run = loadOwnRun(ctx)
  if (run.status !== 'succeeded' || !run.result) {
    throw new ApiError(409, 'NO_RESULT', 'This run has no result to download.')
  }
  const detail = toRunDetail(ctx.db, ctx.user, run)
  const body = toCsv(
    detail.columns.map((c) => c.name),
    detail.rows,
  )
  const slug = (detail.workflowTitle ?? 'flowpilot-result').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'result'
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-v${detail.versionNumber}-${run.id}.csv"`,
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function remove({ db, user, url }: AuthedContext): Response {
  const workflowId = url.searchParams.get('workflowId') || undefined
  const deleted = deleteFinishedRuns(db, user.id, workflowId)
  return json({ deleted })
}
