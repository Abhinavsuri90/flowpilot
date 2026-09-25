import type { DB } from './db'
import { newId, nowIso } from './ids'
import { notFound } from './http'
import { canView, decide, type Relation } from '../lib/policy'
import { LIMITS, type StepLogEntry, type WorkflowDefinition } from '../lib/workflow/schema'
import type {
  Attribution,
  Role,
  RunDetail,
  RunStatus,
  RunSummary,
  UserRef,
  VersionInfo,
  Visibility,
  WorkflowSummary,
} from '../lib/types'

// Access-aware queries. Anything the caller can't see is reported exactly as if
// it didn't exist (404), so ids can't be probed.

export type WorkflowRow = {
  id: string
  owner_id: string
  workspace_id: string
  title: string
  description: string
  visibility: Visibility
  is_example: 0 | 1
  current_version_id: string
  forked_from_version_id: string | null
  created_at: string
  updated_at: string
}

export type VersionRow = {
  id: string
  workflow_id: string
  version_number: number
  definition: string
  created_by: string
  created_at: string
}

export type RunRow = {
  id: string
  version_id: string
  workflow_id: string
  runner_id: string
  status: RunStatus
  parameters: string
  input_name: string | null
  input_rows: number | null
  result: string | null
  step_log: string | null
  summary: string | null
  row_count: number | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  finished_at: string | null
}

export type Caller = { id: string }

// ----- people and roles --------------------------------------------------------

export function userRef(db: DB, userId: string): UserRef {
  const row = db.prepare('SELECT id, display_name, avatar_hue FROM users WHERE id = ?').get(userId) as
    | { id: string; display_name: string; avatar_hue: number }
    | undefined
  return row ? { id: row.id, name: row.display_name, hue: row.avatar_hue } : { id: userId, name: 'Unknown user', hue: 220 }
}

export function roleIn(db: DB, workspaceId: string, userId: string): Role | null {
  const row = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) as
    | { role: Role }
    | undefined
  return row?.role ?? null
}

export function workspaceName(db: DB, workspaceId: string): string {
  return (db.prepare('SELECT name FROM workspaces WHERE id = ?').pluck().get(workspaceId) as string | undefined) ?? 'Unknown'
}

// ----- recipes -------------------------------------------------------------------

export function getWorkflow(db: DB, id: string): WorkflowRow | undefined {
  return db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined
}

export function getVersion(db: DB, id: string): VersionRow | undefined {
  return db.prepare('SELECT * FROM workflow_versions WHERE id = ?').get(id) as VersionRow | undefined
}

export function relationTo(db: DB, caller: Caller, wf: WorkflowRow): Relation {
  return { isOwner: wf.owner_id === caller.id, role: roleIn(db, wf.workspace_id, caller.id) }
}

/** Loads a recipe the caller can see, or throws 404 whether it's missing or merely hidden. */
export function loadViewable(db: DB, caller: Caller, workflowId: string): { wf: WorkflowRow; rel: Relation } {
  const wf = getWorkflow(db, workflowId)
  if (!wf) throw notFound('That recipe')
  const rel = relationTo(db, caller, wf)
  if (!canView(rel, wf.visibility)) throw notFound('That recipe')
  return { wf, rel }
}

export function parseDefinition(version: VersionRow): unknown {
  return JSON.parse(version.definition)
}

export function listVersions(db: DB, workflowId: string): VersionInfo[] {
  const rows = db
    .prepare('SELECT id, version_number, created_by, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC')
    .all(workflowId) as Array<Pick<VersionRow, 'id' | 'version_number' | 'created_by' | 'created_at'>>
  return rows.map((r) => ({ id: r.id, number: r.version_number, createdAt: r.created_at, createdBy: userRef(db, r.created_by) }))
}

function insertVersion(db: DB, workflowId: string, number: number, definition: WorkflowDefinition, userId: string, at: string): VersionRow {
  const row: VersionRow = {
    id: newId('ver'),
    workflow_id: workflowId,
    version_number: number,
    definition: JSON.stringify(definition),
    created_by: userId,
    created_at: at,
  }
  db.prepare(
    'INSERT INTO workflow_versions (id, workflow_id, version_number, definition, created_by, created_at) VALUES (@id, @workflow_id, @version_number, @definition, @created_by, @created_at)',
  ).run(row)
  return row
}

export type CreateWorkflowInput = {
  ownerId: string
  workspaceId: string
  title: string
  description: string
  definition: WorkflowDefinition
  visibility?: Visibility
  isExample?: boolean
  forkedFromVersionId?: string | null
}

/** Recipe + version 1 + current pointer, in one transaction. */
export function createWorkflow(db: DB, input: CreateWorkflowInput): { workflow: WorkflowRow; version: VersionRow } {
  return db.transaction(() => {
    const id = newId('wf')
    const at = nowIso()
    db.prepare(
      `INSERT INTO workflows (id, owner_id, workspace_id, title, description, visibility, is_example, forked_from_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.workspaceId,
      input.title,
      input.description,
      input.visibility ?? 'private',
      input.isExample ? 1 : 0,
      input.forkedFromVersionId ?? null,
      at,
      at,
    )
    const version = insertVersion(db, id, 1, input.definition, input.ownerId, at)
    db.prepare('UPDATE workflows SET current_version_id = ? WHERE id = ?').run(version.id, id)
    return { workflow: getWorkflow(db, id)!, version }
  })()
}

/** Appends the next immutable version and moves the current pointer, in one transaction. */
export function appendVersion(db: DB, wf: WorkflowRow, definition: WorkflowDefinition, userId: string): VersionRow {
  return db.transaction(() => {
    const max = db.prepare('SELECT MAX(version_number) FROM workflow_versions WHERE workflow_id = ?').pluck().get(wf.id) as number
    const at = nowIso()
    const version = insertVersion(db, wf.id, max + 1, definition, userId, at)
    db.prepare('UPDATE workflows SET current_version_id = ?, updated_at = ? WHERE id = ?').run(version.id, at, wf.id)
    return version
  })()
}

export function updateWorkflowMeta(
  db: DB,
  id: string,
  changes: { title?: string; description?: string; visibility?: Visibility },
): void {
  const sets: string[] = []
  const values: Record<string, string> = { id, at: nowIso() }
  for (const key of ['title', 'description', 'visibility'] as const) {
    if (changes[key] !== undefined) {
      sets.push(`${key} = @${key}`)
      values[key] = changes[key]!
    }
  }
  if (!sets.length) return
  db.prepare(`UPDATE workflows SET ${sets.join(', ')}, updated_at = @at WHERE id = @id`).run(values)
}

export function forkCountFor(db: DB, workflowId: string): number {
  return db
    .prepare(
      `SELECT COUNT(*) FROM workflows f JOIN workflow_versions v ON v.id = f.forked_from_version_id WHERE v.workflow_id = ?`,
    )
    .pluck()
    .get(workflowId) as number
}

/** Attribution for a copy: the source's title only while the caller can still see it. */
export function attributionFor(db: DB, caller: Caller, forkedFromVersionId: string | null): Attribution | null {
  if (!forkedFromVersionId) return null
  const version = getVersion(db, forkedFromVersionId)
  if (!version) return null
  const source = getWorkflow(db, version.workflow_id)
  if (!source || !canView(relationTo(db, caller, source), source.visibility)) {
    return { kind: 'hidden', versionNumber: version.version_number }
  }
  return {
    kind: 'visible',
    workflowId: source.id,
    title: source.title,
    owner: userRef(db, source.owner_id),
    versionId: version.id,
    versionNumber: version.version_number,
  }
}

export function toSummary(db: DB, caller: Caller, wf: WorkflowRow, current?: VersionRow): WorkflowSummary {
  const version = current ?? getVersion(db, wf.current_version_id)!
  const def = JSON.parse(version.definition) as Partial<WorkflowDefinition>
  const columns = def.input?.columns ?? {}
  const rel = relationTo(db, caller, wf)
  return {
    id: wf.id,
    title: wf.title,
    description: wf.description,
    visibility: wf.visibility,
    isExample: wf.is_example === 1,
    isMine: wf.owner_id === caller.id,
    owner: userRef(db, wf.owner_id),
    workspace: { id: wf.workspace_id, name: workspaceName(db, wf.workspace_id) },
    currentVersion: { id: version.id, number: version.version_number },
    requiredColumns: Object.entries(columns).map(([name, type]) => ({ name, type })),
    stepCount: def.steps?.length ?? 0,
    parameterNames: Object.keys(def.parameters ?? {}),
    forkedFrom: attributionFor(db, caller, wf.forked_from_version_id),
    canFork: decide('fork', rel, wf.visibility).allowed,
    createdAt: wf.created_at,
    updatedAt: wf.updated_at,
  }
}

export type Scope = 'mine' | 'team' | 'all'

function scopeSql(scope: Scope): string {
  const team = `(w.visibility = 'team' AND w.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = @me))`
  if (scope === 'mine') return 'w.owner_id = @me'
  if (scope === 'team') return team
  return `(w.owner_id = @me OR ${team})`
}

function searchSql(q: string): { sql: string; pattern: string | null } {
  const trimmed = q.trim().slice(0, 100)
  if (!trimmed) return { sql: '', pattern: null }
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return { sql: ` AND (w.title LIKE @q ESCAPE '\\' OR w.description LIKE @q ESCAPE '\\')`, pattern }
}

/** Recipes the caller can read: their own ("mine") or shared with one of their workspaces ("team"). */
export function listWorkflows(db: DB, caller: Caller, scope: Scope, q = ''): WorkflowSummary[] {
  const search = searchSql(q)
  const rows = db
    .prepare(`SELECT w.* FROM workflows w WHERE ${scopeSql(scope)}${search.sql} ORDER BY w.updated_at DESC, w.id`)
    .all({ me: caller.id, q: search.pattern }) as WorkflowRow[]
  return rows.map((wf) => toSummary(db, caller, wf))
}

export function countWorkflows(db: DB, caller: Caller, scope: Scope, q = ''): number {
  const search = searchSql(q)
  return db
    .prepare(`SELECT COUNT(*) FROM workflows w WHERE ${scopeSql(scope)}${search.sql}`)
    .pluck()
    .get({ me: caller.id, q: search.pattern }) as number
}

// ----- runs ------------------------------------------------------------------------

/** Rows stuck in `running` for over 60 s (e.g. the process died mid-run) are finalised as failed STALE. */
export function reapStaleRuns(db: DB, now = Date.now()): number {
  const cutoff = new Date(now - LIMITS.staleRunMs).toISOString()
  return db
    .prepare(
      `UPDATE runs SET status = 'failed', error_code = 'STALE',
         error_message = 'This run did not finish (the server may have restarted), so it was marked as failed.',
         finished_at = @now
       WHERE status = 'running' AND created_at < @cutoff`,
    )
    .run({ cutoff, now: new Date(now).toISOString() }).changes
}

export function insertRun(
  db: DB,
  input: { versionId: string; workflowId: string; runnerId: string; parameters: Record<string, unknown>; inputName: string; inputRows: number },
): string {
  const id = newId('run')
  db.prepare(
    `INSERT INTO runs (id, version_id, workflow_id, runner_id, status, parameters, input_name, input_rows, created_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
  ).run(id, input.versionId, input.workflowId, input.runnerId, JSON.stringify(input.parameters), input.inputName, input.inputRows, nowIso())
  return id
}

export function finishRunSucceeded(
  db: DB,
  id: string,
  input: { result: unknown; stepLog: StepLogEntry[]; summary: string; rowCount: number; durationMs: number },
): void {
  db.prepare(
    `UPDATE runs SET status = 'succeeded', result = ?, step_log = ?, summary = ?, row_count = ?, duration_ms = ?, finished_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(input.result), JSON.stringify(input.stepLog), input.summary, input.rowCount, input.durationMs, nowIso(), id)
}

export function finishRunFailed(db: DB, id: string, input: { code: string; message: string; durationMs: number }): void {
  db.prepare(
    `UPDATE runs SET status = 'failed', error_code = ?, error_message = ?, duration_ms = ?, finished_at = ? WHERE id = ?`,
  ).run(input.code, input.message, input.durationMs, nowIso(), id)
}

export function getRun(db: DB, id: string): RunRow | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
}

export function listRuns(db: DB, runnerId: string, opts: { workflowId?: string; limit?: number } = {}): RunRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  if (opts.workflowId) {
    return db
      .prepare('SELECT * FROM runs WHERE runner_id = ? AND workflow_id = ? ORDER BY created_at DESC, id LIMIT ?')
      .all(runnerId, opts.workflowId, limit) as RunRow[]
  }
  return db.prepare('SELECT * FROM runs WHERE runner_id = ? ORDER BY created_at DESC, id LIMIT ?').all(runnerId, limit) as RunRow[]
}

/** "Delete my results": removes the caller's finished runs (optionally for one recipe). */
export function deleteFinishedRuns(db: DB, runnerId: string, workflowId?: string): number {
  const sql = `DELETE FROM runs WHERE runner_id = ? AND status <> 'running'${workflowId ? ' AND workflow_id = ?' : ''}`
  return db.prepare(sql).run(...(workflowId ? [runnerId, workflowId] : [runnerId])).changes
}

export function toRunSummary(db: DB, caller: Caller, run: RunRow): RunSummary {
  const wf = getWorkflow(db, run.workflow_id)
  const readable = !!wf && canView(relationTo(db, caller, wf), wf.visibility)
  const versionNumber = (db.prepare('SELECT version_number FROM workflow_versions WHERE id = ?').pluck().get(run.version_id) as number) ?? 0
  return {
    id: run.id,
    status: run.status,
    workflowId: run.workflow_id,
    workflowTitle: readable ? wf!.title : null,
    recipeAvailable: readable,
    versionId: run.version_id,
    versionNumber,
    parameters: JSON.parse(run.parameters),
    inputName: run.input_name,
    inputRows: run.input_rows,
    rowCount: run.row_count,
    summary: run.summary,
    durationMs: run.duration_ms,
    errorCode: run.error_code,
    errorMessage: run.error_message,
    createdAt: run.created_at,
    finishedAt: run.finished_at,
  }
}

export function toRunDetail(db: DB, caller: Caller, run: RunRow): RunDetail {
  const result = run.result
    ? (JSON.parse(run.result) as Pick<RunDetail, 'columns' | 'rows' | 'ignoredColumns'>)
    : { columns: [], rows: [], ignoredColumns: [] }
  return {
    ...toRunSummary(db, caller, run),
    columns: result.columns,
    rows: result.rows,
    ignoredColumns: result.ignoredColumns ?? [],
    stepLog: run.step_log ? JSON.parse(run.step_log) : [],
  }
}
