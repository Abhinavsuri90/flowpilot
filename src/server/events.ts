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
  | 'workflow.transferred'
  | 'workflow.archived'
  | 'workflow.restored'
  | 'run.succeeded'
  | 'run.failed'
  | 'role.changed'
  | 'workspace.created'
  | 'workspace.renamed'
  | 'member.joined'
  | 'member.left'
  | 'member.removed'
  | 'invite.created'
  | 'invite.revoked'

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
const ACTIVITY_BATCH = 200
/** Upper bound on events read per feed, however little of it is relevant. */
const ACTIVITY_MAX_SCANNED = 2_000

/** The activity feed of one workspace, as the viewer is allowed to see it. */
export function listActivity(db: DB, viewer: { id: string }, workspaceId: string | null, limit = 12): ActivityItem[] {
  if (!workspaceId) return []
  // Rules that need no lookups run in SQL (other people's runs are private; a copy
  // is news only to its maker and the source owner; invites are for admins), so a
  // busy workspace can't push everything relevant out of the window. The rest is
  // checked per row, reading further back in batches until the feed is full.
  const isAdmin = roleOf(db, workspaceId, viewer.id) === 'admin' ? 1 : 0
  const page = db.prepare(
    `SELECT * FROM events
      WHERE id < @before
        AND workspace_id = @ws
        AND (type NOT IN ('run.succeeded', 'run.failed') OR actor_id = @me)
        AND (type <> 'workflow.forked' OR actor_id = @me OR workflow_id IN (SELECT id FROM workflows WHERE owner_id = @me))
        AND (type NOT IN ('invite.created', 'invite.revoked') OR @admin = 1)
      ORDER BY id DESC
      LIMIT @batch`,
  )
  const items: ActivityItem[] = []
  let before = Number.MAX_SAFE_INTEGER
  for (let scanned = 0; items.length < limit && scanned < ACTIVITY_MAX_SCANNED; ) {
    const rows = page.all({ me: viewer.id, ws: workspaceId, admin: isAdmin, before, batch: ACTIVITY_BATCH }) as EventRow[]
    for (const row of rows) {
      const item = describeEvent(db, viewer, row)
      if (item) items.push(item)
      if (items.length >= limit) break
    }
    if (rows.length < ACTIVITY_BATCH) break
    scanned += rows.length
    before = rows[rows.length - 1]!.id
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
    // Results can be deleted ("Delete my results"); then the item stops linking to them.
    const runId = typeof detail.runId === 'string' ? detail.runId : null
    const kept = !!runId && db.prepare('SELECT 1 FROM runs WHERE id = ? AND runner_id = ?').get(runId, viewer.id) !== undefined
    return {
      ...base,
      text: `You ${outcome} ${title}${readable ? v : ''}${runId && !kept ? ' (result deleted)' : ''}`,
      workflowId: readable ? wf!.id : null,
      runId: kept ? runId : null,
    }
  }

  if (row.type === 'role.changed') {
    const role = roleOf(db, row.workspace_id, viewer.id)
    if (!role) return null
    const targetId = String(detail.targetUserId ?? '')
    const target = targetId === viewer.id ? 'your' : `${userRef(db, targetId).name}'s`
    return { ...base, text: `${who} changed ${target} role to ${String(detail.to)} in ${workspaceName(db, row.workspace_id)}` }
  }

  // Workspace events: only for current members.
  if (row.type.startsWith('workspace.') || row.type.startsWith('member.') || row.type.startsWith('invite.')) {
    if (!roleOf(db, row.workspace_id, viewer.id)) return null
    const target = typeof detail.targetUserId === 'string' ? (detail.targetUserId === viewer.id ? 'you' : userRef(db, detail.targetUserId).name) : 'someone'
    switch (row.type) {
      case 'workspace.created':
        return { ...base, text: `${who} created the workspace ${String(detail.name ?? workspaceName(db, row.workspace_id))}` }
      case 'workspace.renamed':
        return { ...base, text: `${who} renamed the workspace to ${String(detail.to)}` }
      case 'member.joined':
        return { ...base, text: `${who} joined ${workspaceName(db, row.workspace_id)} as ${String(detail.role)}` }
      case 'member.left':
        return { ...base, text: `${who} left ${workspaceName(db, row.workspace_id)}` }
      case 'member.removed':
        return { ...base, text: `${who} removed ${target} from ${workspaceName(db, row.workspace_id)}` }
      case 'invite.created':
        return { ...base, text: `${who} created an invite link for ${detail.email ? String(detail.email) : 'anyone with the link'} (${String(detail.role)})` }
      case 'invite.revoked':
        return { ...base, text: `${who} revoked an invite link` }
      default:
        return null
    }
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
    case 'workflow.archived':
      return { ...base, text: `${who} archived ${wf.title}`, workflowId: wf.id }
    case 'workflow.restored':
      return { ...base, text: `${who} restored ${wf.title}`, workflowId: wf.id }
    case 'workflow.transferred': {
      const toId = String(detail.toUserId ?? '')
      const to = toId === viewer.id ? 'you' : userRef(db, toId).name
      return { ...base, text: `${who} handed ${wf.title} over to ${to}`, workflowId: wf.id }
    }
    default:
      return null
  }
}

function roleOf(db: DB, workspaceId: string, userId: string): string | null {
  return (db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').pluck().get(workspaceId, userId) as
    | string
    | undefined) ?? null
}

// ----- The admin audit log ------------------------------------------------------------

export const AUDIT_CATEGORIES = {
  recipes: ['workflow.created', 'workflow.updated', 'workflow.version_saved', 'workflow.forked', 'workflow.transferred', 'workflow.archived', 'workflow.restored'],
  sharing: ['workflow.shared', 'workflow.unshared'],
  people: ['member.joined', 'member.left', 'member.removed', 'role.changed'],
  invites: ['invite.created', 'invite.revoked'],
  workspace: ['workspace.created', 'workspace.renamed'],
} as const satisfies Record<string, readonly EventType[]>
export type AuditCategory = keyof typeof AUDIT_CATEGORIES

const categoryOf = (type: string): AuditCategory =>
  (Object.entries(AUDIT_CATEGORIES).find(([, types]) => (types as readonly string[]).includes(type))?.[0] ?? 'recipes') as AuditCategory

export type AuditEntry = {
  id: number
  at: string
  actor: { id: string; name: string; hue: number }
  category: AuditCategory
  action: string
  text: string
  /** The recipe it concerns, when the admin can see it. */
  recipe: { id: string; title: string } | null
}

/**
 * The workspace's audit log for an admin: every recipe, sharing, people, invite
 * and workspace event. Runs are never listed (they are private to their runner),
 * a private recipe the admin can't see is named only as "a private recipe", and a
 * copy never reveals its own title.
 */
export function listAudit(
  db: DB,
  admin: { id: string },
  workspaceId: string,
  opts: { category?: AuditCategory; actorId?: string; before?: number; limit?: number } = {},
): { entries: AuditEntry[]; nextBefore: number | null } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 10_000)
  const types = opts.category ? [...AUDIT_CATEGORIES[opts.category]] : Object.values(AUDIT_CATEGORIES).flat()
  const rows = db
    .prepare(
      `SELECT * FROM events
        WHERE workspace_id = @ws AND id < @before AND type IN (${types.map((_, i) => `@t${i}`).join(', ')})
          ${opts.actorId ? 'AND actor_id = @actor' : ''}
        ORDER BY id DESC
        LIMIT @limit`,
    )
    .all({
      ws: workspaceId,
      before: opts.before ?? Number.MAX_SAFE_INTEGER,
      actor: opts.actorId ?? null,
      limit: limit + 1,
      ...Object.fromEntries(types.map((t, i) => [`t${i}`, t])),
    }) as EventRow[]
  const page = rows.slice(0, limit)
  return { entries: page.map((row) => auditEntry(db, admin, row)), nextBefore: rows.length > limit ? page[page.length - 1]!.id : null }
}

function auditEntry(db: DB, admin: { id: string }, row: EventRow): AuditEntry {
  const detail = JSON.parse(row.detail) as Record<string, unknown>
  const actor = userRef(db, row.actor_id)
  const wf = row.workflow_id ? getWorkflow(db, row.workflow_id) : undefined
  const visible = !!wf && canView(relationTo(db, admin, wf), wf.visibility)
  const recipe = visible ? `“${wf!.title}”` : 'a private recipe'
  const v = typeof detail.versionNumber === 'number' ? ` (v${detail.versionNumber})` : ''
  const person = (id: unknown) => (typeof id === 'string' ? userRef(db, id).name : 'someone')
  const texts: Partial<Record<EventType, string>> = {
    'workflow.created': `created ${recipe}`,
    'workflow.updated': `edited the details of ${recipe}`,
    'workflow.version_saved': `saved a new version of ${recipe}${v}`,
    'workflow.forked': `made a private copy of ${recipe}${typeof detail.sourceVersionNumber === 'number' ? ` (v${detail.sourceVersionNumber})` : ''}`,
    'workflow.transferred': `handed ${recipe} over to ${person(detail.toUserId)}`,
    'workflow.archived': `archived ${recipe}`,
    'workflow.restored': `restored ${recipe}`,
    'workflow.shared': `shared ${recipe} with the workspace`,
    'workflow.unshared': `made ${recipe} private`,
    'member.joined': `joined as ${String(detail.role ?? 'member')}`,
    'member.left': `left the workspace${typeof detail.transferred === 'number' && detail.transferred ? ` (${detail.transferred} recipe${detail.transferred === 1 ? '' : 's'} handed to ${person(detail.heirId)})` : ''}`,
    'member.removed': `removed ${person(detail.targetUserId)}${typeof detail.transferred === 'number' && detail.transferred ? ` (${detail.transferred} recipe${detail.transferred === 1 ? '' : 's'} handed over)` : ''}`,
    'role.changed': `changed ${person(detail.targetUserId)}'s role from ${String(detail.from)} to ${String(detail.to)}`,
    'invite.created': `created an invite link for ${detail.email ? String(detail.email) : 'anyone with the link'} (${String(detail.role)})`,
    'invite.revoked': 'revoked an invite link',
    'workspace.created': `created the workspace ${String(detail.name ?? '')}`.trim(),
    'workspace.renamed': `renamed the workspace from ${String(detail.from)} to ${String(detail.to)}`,
  }
  return {
    id: row.id,
    at: row.created_at,
    actor,
    category: categoryOf(row.type),
    action: row.type,
    text: `${actor.name} ${texts[row.type] ?? row.type}`,
    recipe: visible ? { id: wf!.id, title: wf!.title } : null,
  }
}
