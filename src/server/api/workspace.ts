import { z } from 'zod'
import { ApiError, forbidden, invalid, json, notFound, readJson } from '../http'
import { recordEvent } from '../events'
import { currentMembership } from '../auth'
import { adminCount, findUserById, removeMember as removeFromWorkspace, renameWorkspace, seniorAdmin } from '../accounts'
import { canManageMembers, canManageRoles, decideLeave, decideRemoval, decideRoleChange } from '../../lib/policy'
import { workspaceNameProblem } from '../../lib/account'
import type { Membership, Role, WorkspaceInfo } from '../../lib/types'
import type { AuthedContext } from './context'
import { toMe } from './auth'

const RoleBody = z.strictObject({
  role: z.enum(['admin', 'member', 'viewer'], { error: 'Role must be admin, member or viewer' }),
  workspaceId: z.string().min(1).max(64).optional(),
})
const RenameBody = z.strictObject({ name: z.string({ error: 'Give the workspace a name' }) })

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue?.code === 'unrecognized_keys' ? `Unknown field ${issue.keys.map((k) => `"${k}"`).join(', ')}` : issue?.message ?? 'Invalid request'
}

/** The workspace a request is about: an explicit one the caller belongs to, else the one they're working in. */
function resolveWorkspace(ctx: AuthedContext, requested: string | null | undefined): Membership {
  const membership = requested ? ctx.user.memberships.find((m) => m.workspaceId === requested) : currentMembership(ctx.user)
  // Not a member (or no such workspace): hide it.
  if (!membership) throw notFound('That workspace')
  return membership
}

export function get(ctx: AuthedContext): Response {
  const membership = resolveWorkspace(ctx, ctx.url.searchParams.get('workspaceId'))
  const rows = ctx.db
    .prepare(
      `SELECT u.id, u.display_name, u.email, u.avatar_hue, u.is_demo, m.role, m.joined_at,
              (SELECT COUNT(*) FROM workflows w WHERE w.workspace_id = m.workspace_id AND w.owner_id = u.id) AS recipes
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?
        ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.display_name`,
    )
    .all(membership.workspaceId) as Array<{
    id: string
    display_name: string
    email: string
    avatar_hue: number
    is_demo: 0 | 1
    role: Role
    joined_at: string
    recipes: number
  }>
  const body: WorkspaceInfo = {
    workspace: { id: membership.workspaceId, name: membership.workspaceName },
    role: membership.role,
    members: rows.map((r) => ({
      user: { id: r.id, name: r.display_name, hue: r.avatar_hue, email: r.email },
      role: r.role,
      joinedAt: r.joined_at,
      isYou: r.id === ctx.user.id,
      isDemo: r.is_demo === 1,
      recipeCount: r.recipes,
    })),
    canManageRoles: canManageRoles(membership.role),
    canManageMembers: canManageMembers(membership.role),
    adminCount: adminCount(ctx.db, membership.workspaceId),
  }
  return json(body)
}

/** Admins manage roles only. Roles are read per request, so a change applies on the member's next request. */
export async function setRole(ctx: AuthedContext): Promise<Response> {
  const parsed = RoleBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid(firstIssue(parsed.error))
  const membership = resolveWorkspace(ctx, parsed.data.workspaceId)
  const targetId = ctx.params.userId!
  const target = ctx.db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(membership.workspaceId, targetId) as { role: Role } | undefined
  if (!target) throw notFound('That member')

  const decision = decideRoleChange({
    actorId: ctx.user.id,
    actorRole: membership.role,
    targetId,
    targetRole: target.role,
    newRole: parsed.data.role,
    adminCount: adminCount(ctx.db, membership.workspaceId),
  })
  if (!decision.allowed) throw new ApiError(decision.status, decision.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', decision.reason)

  if (target.role !== parsed.data.role) {
    ctx.db
      .prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
      .run(parsed.data.role, membership.workspaceId, targetId)
    recordEvent(ctx.db, {
      workspaceId: membership.workspaceId,
      actorId: ctx.user.id,
      type: 'role.changed',
      detail: { targetUserId: targetId, from: target.role, to: parsed.data.role },
    })
  }
  return json({ userId: targetId, role: parsed.data.role })
}

/** PATCH /api/workspace: rename the workspace you're working in (admins). */
export async function rename(ctx: AuthedContext): Promise<Response> {
  const membership = resolveWorkspace(ctx, null)
  if (!canManageMembers(membership.role)) throw forbidden('Only admins can rename the workspace')
  if (ctx.user.isDemo) throw forbidden('Demo workspaces keep their names')
  const parsed = RenameBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid(firstIssue(parsed.error))
  const name = parsed.data.name.trim()
  const problem = workspaceNameProblem(name)
  if (problem) throw invalid(problem, [{ path: 'name', message: problem }])
  if (name !== membership.workspaceName) {
    renameWorkspace(ctx.db, membership.workspaceId, name)
    recordEvent(ctx.db, { workspaceId: membership.workspaceId, actorId: ctx.user.id, type: 'workspace.renamed', detail: { from: membership.workspaceName, to: name } })
  }
  return json({ workspace: { id: membership.workspaceId, name } })
}

/** DELETE /api/workspace/members/:userId: admins remove someone; their recipes here move to the admin. */
export function removeMember(ctx: AuthedContext): Response {
  const membership = resolveWorkspace(ctx, ctx.url.searchParams.get('workspaceId'))
  const targetId = ctx.params.userId!
  const targetRole = ctx.db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .pluck()
    .get(membership.workspaceId, targetId) as Role | undefined
  if (!targetRole) throw notFound('That member')
  const decision = decideRemoval({
    actorId: ctx.user.id,
    actorRole: membership.role,
    targetId,
    targetIsDemo: findUserById(ctx.db, targetId)?.is_demo === 1,
  })
  if (!decision.allowed) throw new ApiError(decision.status, decision.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', decision.reason)

  const { transferred } = removeFromWorkspace(ctx.db, { workspaceId: membership.workspaceId, userId: targetId, heirId: ctx.user.id })
  recordEvent(ctx.db, {
    workspaceId: membership.workspaceId,
    actorId: ctx.user.id,
    type: 'member.removed',
    detail: { targetUserId: targetId, role: targetRole, transferred },
  })
  return json({ removed: targetId, transferred })
}

/** POST /api/workspace/leave: leave the workspace you're working in; your recipes stay with it. */
export function leave(ctx: AuthedContext): Response {
  const membership = resolveWorkspace(ctx, null)
  const admins = adminCount(ctx.db, membership.workspaceId)
  const decision = decideLeave({ role: membership.role, adminCount: admins, isDemo: ctx.user.isDemo })
  if (!decision.allowed) throw new ApiError(decision.status, decision.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', decision.reason)
  // Every workspace keeps at least one admin, so there is always someone to inherit.
  const heirId = seniorAdmin(ctx.db, membership.workspaceId, ctx.user.id)!
  const { transferred } = removeFromWorkspace(ctx.db, { workspaceId: membership.workspaceId, userId: ctx.user.id, heirId })
  recordEvent(ctx.db, { workspaceId: membership.workspaceId, actorId: ctx.user.id, type: 'member.left', detail: { transferred, heirId } })
  const remaining = ctx.user.memberships.filter((m) => m.workspaceId !== membership.workspaceId)
  return json({ left: membership.workspaceId, transferred, me: toMe({ ...ctx.user, memberships: remaining, activeWorkspaceId: null }) })
}
