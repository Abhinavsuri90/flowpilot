import type { DB } from './db'
import { nowIso } from './ids'
import { getWorkflow, relationTo, userRef, workspaceName } from './repo'
import { canView } from '../lib/policy'
import type { ActivityItem } from '../lib/types'

// Append-only audit log (triggers reject UPDATE and DELETE). Events hold ids,
// version numbers and statuses, never uploaded rows or results.

export type EventType =
  | 'workflow.created'
  | 'workflow.updated'
  | 'workflow.version_saved'
  | 'workflow.shared'
  | 'workflow.unshared'
  | 'workflow.forked'
  | 'run.succeeded'
  | 'run.failed'
  | 'role.changed'

export function recordEvent(
  db: DB,
  event: { workspaceId: string; actorId: string; type: EventType; workflowId?: string | null; detail?: Record<string, unknown> },
): void {
  db.prepare('INSERT INTO events (workspace_id, actor_id, type, workflow_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    event.workspaceId,
    event.actorId,
    event.type,
    event.workflowId ?? null,
    JSON.stringify(event.detail ?? {}),
    nowIso(),
  )
}

type EventRow = {
  id: number
  workspace_id: string
  actor_id: string
  type: EventType
  workflow_id: string | null
  detail: string
  created_at: string
}

/**
 * The activity feed, filtered with the same rules as everything else:
 * runs only for their runner, recipe events only while the viewer can read the
 * recipe, and a copy is announced to the source owner without revealing it.
 */
export function listActivity(db: DB, viewer: { id: string }, limit = 12): ActivityItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM events
        WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = @me)
           OR actor_id = @me
           OR workflow_id IN (SELECT id FROM workflows WHERE owner_id = @me)
        ORDER BY id DESC
        LIMIT 400`,
    )
    .all({ me: viewer.id }) as EventRow[]

  const items: ActivityItem[] = []
  for (const row of rows) {
    const item = describeEvent(db, viewer, row)
    if (item) items.push(item)
    if (items.length >= limit) break
  }
  return items
}

function describeEvent(db: DB, viewer: { id: string }, row: EventRow): ActivityItem | null {
  const detail = JSON.parse(row.detail) as Record<string, unknown>
  const isYou = row.actor_id === viewer.id
  const actor = userRef(db, row.actor_id)
  const who = isYou ? 'You' : actor.name
  const base = { id: row.id, type: row.type, createdAt: row.created_at, actor, isYou, workflowId: null, runId: null }

  if (row.type === 'run.succeeded' || row.type === 'run.failed') {
    if (!isYou) return null // runs are private to their runner
    const wf = row.workflow_id ? getWorkflow(db, row.workflow_id) : undefined
    const readable = !!wf && canView(relationTo(db, viewer, wf), wf.visibility)
    const title = readable ? wf!.title : 'a recipe you no longer have access to'
    const v = typeof detail.versionNumber === 'number' ? ` v${detail.versionNumber}` : ''
    const outcome = row.type === 'run.succeeded' ? 'ran' : 'had a failed run of'
    return {
      ...base,
      text: `You ${outcome} ${title}${readable ? v : ''}`,
      workflowId: readable ? wf!.id : null,
      runId: typeof detail.runId === 'string' ? detail.runId : null,
    }
  }

  if (row.type === 'role.changed') {
    const role = roleOf(db, row.workspace_id, viewer.id)
    if (!role) return null
    const targetId = String(detail.targetUserId ?? '')
    const target = targetId === viewer.id ? 'your' : `${userRef(db, targetId).name}'s`
    return { ...base, text: `${who} changed ${target} role to ${String(detail.to)} in ${workspaceName(db, row.workspace_id)}` }
  }

  const wf = row.workflow_id ? getWorkflow(db, row.workflow_id) : undefined
  if (!wf) return null

  if (row.type === 'workflow.forked') {
    const sourceVersion = typeof detail.sourceVersionNumber === 'number' ? ` v${detail.sourceVersionNumber}` : ''
    if (isYou) {
      const copy = typeof detail.copyId === 'string' ? getWorkflow(db, detail.copyId) : undefined
      return {
        ...base,
        text: `You made a private copy of ${wf.title}${sourceVersion}${copy ? ` as ${copy.title}` : ''}`,
        workflowId: copy?.id ?? null,
      }
    }
    // The source owner learns a copy exists, never its title or id.
    if (wf.owner_id === viewer.id) {
      return { ...base, text: `${actor.name} made a private copy of your ${wf.title}${sourceVersion}`, workflowId: wf.id }
    }
    return null
  }

  if (!canView(relationTo(db, viewer, wf), wf.visibility)) return null
  const n = typeof detail.versionNumber === 'number' ? detail.versionNumber : null
  switch (row.type) {
    case 'workflow.created':
      return { ...base, text: `${who} created ${wf.title}`, workflowId: wf.id }
    case 'workflow.version_saved':
      return { ...base, text: `${who} saved ${wf.title}${n ? ` v${n}` : ''}`, workflowId: wf.id }
    case 'workflow.shared':
      return { ...base, text: `${who} shared ${wf.title} with ${workspaceName(db, wf.workspace_id)}`, workflowId: wf.id }
    case 'workflow.unshared':
      return { ...base, text: `${who} made ${wf.title} private`, workflowId: wf.id }
    case 'workflow.updated':
      return { ...base, text: `${who} updated the details of ${wf.title}`, workflowId: wf.id }
    default:
      return null
  }
}

function roleOf(db: DB, workspaceId: string, userId: string): string | null {
  return (db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').pluck().get(workspaceId, userId) as
    | string
    | undefined) ?? null
}
