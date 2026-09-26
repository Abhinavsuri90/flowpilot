import { z } from 'zod'
import { forbidden, invalid, json, notFound, readJson } from '../http'
import {
  appendVersion,
  countWorkflows,
  createWorkflow,
  forkCountFor,
  getVersion,
  listVersions,
  listWorkflows,
  loadViewable,
  relationTo,
  toSummary,
  updateWorkflowMeta,
  userRef,
  workspaceName,
  WORKFLOW_PAGE,
  type Scope,
} from '../repo'
import { recordEvent } from '../events'
import { canCreateInWorkspace, decide, decideAll } from '../../lib/policy'
import { validateDefinition } from '../../lib/workflow/validate'
import { LIMITS, type WorkflowDefinition } from '../../lib/workflow/schema'
import type { AccessMember, Action, PermissionInfo, Role, WorkflowAccess, WorkflowDetail, WorkflowList } from '../../lib/types'
import type { AuthedContext } from './context'

const title = z
  .string({ error: 'Give the recipe a title' })
  .trim()
  .min(1, { error: 'Give the recipe a title' })
  .max(LIMITS.titleMax, { error: `Titles can be at most ${LIMITS.titleMax} characters` })
const description = z
  .string()
  .trim()
  .max(LIMITS.descriptionMax, { error: `Descriptions can be at most ${LIMITS.descriptionMax} characters` })

// Create bodies ignore identity fields such as owner_id (they come from the session).
const CreateBody = z.object({ title, description: description.optional().default(''), definition: z.unknown() })
// Update bodies are strict: an unknown key such as owner_id is rejected.
const PatchBody = z
  .strictObject({ title: title.optional(), description: description.optional(), visibility: z.enum(['private', 'team']).optional() })
  .refine((b) => Object.keys(b).length > 0, { error: 'Nothing to update' })
const VersionBody = z.object({ definition: z.unknown() })
const ForkBody = z.object({ versionId: z.string().min(1).max(64), title })

function bodyIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message:
      issue.code === 'unrecognized_keys'
        ? `Unknown field${issue.keys.length > 1 ? 's' : ''} ${issue.keys.map((k) => `"${k}"`).join(', ')}`
        : issue.message,
  }))
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issues = bodyIssues(parsed.error)
    throw invalid(issues[0]?.message ?? 'The request body is not valid', issues)
  }
  return parsed.data
}

/** Full validation of a definition from the browser, the model or the database. */
function requireValid(raw: unknown, code = 'VALIDATION_FAILED'): WorkflowDefinition {
  const result = validateDefinition(raw)
  if (!result.ok) {
    const count = result.issues.length
    throw invalid(`The recipe has ${count === 1 ? 'a problem' : `${count} problems`} to fix`, result.issues, code)
  }
  return result.definition
}

function permissionInfo(decisions: ReturnType<typeof decideAll>): Record<Action, PermissionInfo> {
  const out = {} as Record<Action, PermissionInfo>
  for (const [action, d] of Object.entries(decisions) as Array<[Action, (typeof decisions)[Action]]>) {
    out[action] = d.allowed ? { allowed: true, reason: d.reason } : { allowed: false, reason: d.reason, status: d.status }
  }
  return out
}

/** A non-negative whole number from the query string, or undefined. */
function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name)
  return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined
}

export function list({ db, user, url }: AuthedContext): Response {
  const scopeParam = url.searchParams.get('scope')
  const scope: Scope = scopeParam === 'team' || scopeParam === 'all' ? scopeParam : 'mine'
  const q = url.searchParams.get('q') ?? ''
  const limit = Math.min(Math.max(intParam(url, 'limit') ?? WORKFLOW_PAGE.default, 1), WORKFLOW_PAGE.max)
  const offset = intParam(url, 'offset') ?? 0
  const items = listWorkflows(db, user, scope, q, { limit, offset })
  const total = countWorkflows(db, user, scope, q)
  const body: WorkflowList = {
    items,
    counts: { mine: countWorkflows(db, user, 'mine', q), team: countWorkflows(db, user, 'team', q) },
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null,
  }
  return json(body)
}

export async function create({ db, user, request }: AuthedContext): Promise<Response> {
  // The workspace is derived from the session: the first one where the caller may create.
  const home = user.memberships.find((m) => canCreateInWorkspace(m.role))
  if (!home) {
    throw forbidden(
      user.memberships.length ? 'Viewers can run recipes but cannot create them' : 'You need to belong to a workspace to create recipes',
    )
  }
  const body = parseBody(CreateBody, await readJson(request))
  const definition = requireValid(body.definition)
  const { workflow, version } = createWorkflow(db, {
    ownerId: user.id,
    workspaceId: home.workspaceId,
    title: body.title,
    description: body.description,
    definition,
  })
  recordEvent(db, { workspaceId: home.workspaceId, actorId: user.id, type: 'workflow.created', workflowId: workflow.id, detail: { versionNumber: 1 } })
  return json({ workflow: toSummary(db, user, workflow, version), version: { id: version.id, number: 1 } }, { status: 201 })
}

export function detail({ db, user, params, url }: AuthedContext): Response {
  const { wf, rel } = loadViewable(db, user, params.id!)
  const requested = url.searchParams.get('v')
  const version = getVersion(db, requested || wf.current_version_id)
  // A ?v= from another recipe is treated as not found.
  if (!version || version.workflow_id !== wf.id) throw notFound('That version')
  const versions = listVersions(db, wf.id)
  const body: WorkflowDetail = {
    workflow: toSummary(db, user, wf),
    version: {
      id: version.id,
      number: version.version_number,
      createdAt: version.created_at,
      createdBy: userRef(db, version.created_by),
      definition: JSON.parse(version.definition) as WorkflowDefinition,
      isLatest: version.id === wf.current_version_id,
    },
    versions,
    latestVersionNumber: versions[0]?.number ?? version.version_number,
    permissions: permissionInfo(decideAll(rel, wf.visibility)),
    role: rel.role,
    isOwner: rel.isOwner,
    forkCount: rel.isOwner ? forkCountFor(db, wf.id) : null,
  }
  return json(body)
}

export async function patch({ db, user, params, request }: AuthedContext): Promise<Response> {
  const { wf, rel } = loadViewable(db, user, params.id!)
  const body = parseBody(PatchBody, await readJson(request))
  const editsDetails = body.title !== undefined || body.description !== undefined
  if (editsDetails) {
    const d = decide('edit', rel, wf.visibility)
    if (!d.allowed) throw forbidden('Only the owner can change the title or description')
  }
  if (body.visibility !== undefined) {
    const d = decide('share', rel, wf.visibility)
    if (!d.allowed) throw forbidden(d.reason)
  }

  // Only real changes are written, so a repeated or no-op PATCH doesn't move the
  // recipe to the top of the library (ordered by updated_at).
  const changes = {
    ...(body.title !== undefined && body.title !== wf.title ? { title: body.title } : {}),
    ...(body.description !== undefined && body.description !== wf.description ? { description: body.description } : {}),
    ...(body.visibility !== undefined && body.visibility !== wf.visibility ? { visibility: body.visibility } : {}),
  }
  updateWorkflowMeta(db, wf.id, changes)
  const detailsChanged = changes.title !== undefined || changes.description !== undefined
  if (detailsChanged) {
    recordEvent(db, { workspaceId: wf.workspace_id, actorId: user.id, type: 'workflow.updated', workflowId: wf.id })
  }
  if (changes.visibility) {
    recordEvent(db, {
      workspaceId: wf.workspace_id,
      actorId: user.id,
      type: changes.visibility === 'team' ? 'workflow.shared' : 'workflow.unshared',
      workflowId: wf.id,
    })
  }
  const updated = loadViewable(db, user, wf.id).wf
  return json({ workflow: toSummary(db, user, updated) })
}

export async function saveVersion({ db, user, params, request }: AuthedContext): Promise<Response> {
  const { wf, rel } = loadViewable(db, user, params.id!)
  const d = decide('edit', rel, wf.visibility)
  if (!d.allowed) throw forbidden(d.reason)
  const body = parseBody(VersionBody, await readJson(request))
  const definition = requireValid(body.definition)
  const version = appendVersion(db, wf, definition, user.id)
  recordEvent(db, {
    workspaceId: wf.workspace_id,
    actorId: user.id,
    type: 'workflow.version_saved',
    workflowId: wf.id,
    detail: { versionNumber: version.version_number },
  })
  return json({ workflowId: wf.id, version: { id: version.id, number: version.version_number } }, { status: 201 })
}

export async function fork({ db, user, params, request }: AuthedContext): Promise<Response> {
  const { wf, rel } = loadViewable(db, user, params.id!)
  const body = parseBody(ForkBody, await readJson(request))
  const source = getVersion(db, body.versionId)
  if (!source || source.workflow_id !== wf.id) throw notFound('That version')
  const d = decide('fork', rel, wf.visibility)
  if (!d.allowed) throw forbidden(d.reason)

  // The copy gets its own version 1 of the exact source definition, re-validated.
  const definition = requireValid(JSON.parse(source.definition), 'DEFINITION_INVALID')
  const { workflow, version } = createWorkflow(db, {
    ownerId: user.id,
    workspaceId: wf.workspace_id,
    title: body.title,
    description: wf.description,
    definition,
    forkedFromVersionId: source.id,
  })
  recordEvent(db, {
    workspaceId: wf.workspace_id,
    actorId: user.id,
    type: 'workflow.forked',
    workflowId: wf.id,
    detail: { sourceVersionId: source.id, sourceVersionNumber: source.version_number, copyId: workflow.id },
  })
  return json({ workflow: toSummary(db, user, workflow, version), version: { id: version.id, number: 1 } }, { status: 201 })
}

export function access({ db, user, params }: AuthedContext): Response {
  const { wf } = loadViewable(db, user, params.id!)
  const members = db
    .prepare(
      `SELECT m.user_id, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.display_name`,
    )
    .all(wf.workspace_id) as Array<{ user_id: string; role: Role }>
  const body: WorkflowAccess = {
    workflowId: wf.id,
    visibility: wf.visibility,
    workspace: { id: wf.workspace_id, name: workspaceName(db, wf.workspace_id) },
    members: members.map((m): AccessMember => {
      const rel = relationTo(db, { id: m.user_id }, wf)
      const decisions = decideAll(rel, wf.visibility)
      return {
        user: userRef(db, m.user_id),
        role: m.role,
        isOwner: rel.isOwner,
        isYou: m.user_id === user.id,
        can: {
          view: decisions.view.allowed,
          run: decisions.run.allowed,
          fork: decisions.fork.allowed,
          edit: decisions.edit.allowed,
          share: decisions.share.allowed,
        },
      }
    }),
  }
  return json(body)
}

