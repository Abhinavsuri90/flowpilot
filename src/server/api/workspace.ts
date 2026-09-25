import { z } from 'zod'
import { ApiError, invalid, json, notFound, readJson } from '../http'
import { recordEvent } from '../events'
import { canManageRoles, decideRoleChange } from '../../lib/policy'
import type { Role, WorkspaceInfo } from '../../lib/types'
import type { AuthedContext } from './context'
import type { DB } from '../db'

const RoleBody = z.strictObject({
  role: z.enum(['admin', 'member', 'viewer'], { error: 'Role must be admin, member or viewer' }),
  workspaceId: z.string().min(1).max(64).optional(),
})

function resolveWorkspace(ctx: AuthedContext, requested: string | null | undefined) {
  const membership = requested
    ? ctx.user.memberships.find((m) => m.workspaceId === requested)
    : ctx.user.memberships[0]
  // Not a member (or no such workspace): hide it.
  if (!membership) throw notFound('That workspace')
  return membership
}

function adminCount(db: DB, workspaceId: string): number {
  return db.prepare(`SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`).pluck().get(workspaceId) as number
}

export function get(ctx: AuthedContext): Response {
  const membership = resolveWorkspace(ctx, ctx.url.searchParams.get('workspaceId'))
  const rows = ctx.db
    .prepare(
      `SELECT u.id, u.display_name, u.email, u.avatar_hue, m.role, m.joined_at
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?
        ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.display_name`,
    )
    .all(membership.workspaceId) as Array<{ id: string; display_name: string; email: string; avatar_hue: number; role: Role; joined_at: string }>
  const body: WorkspaceInfo = {
    workspace: { id: membership.workspaceId, name: membership.workspaceName },
    role: membership.role,
    members: rows.map((r) => ({
      user: { id: r.id, name: r.display_name, hue: r.avatar_hue, email: r.email },
      role: r.role,
      joinedAt: r.joined_at,
      isYou: r.id === ctx.user.id,
    })),
    canManageRoles: canManageRoles(membership.role),
    adminCount: adminCount(ctx.db, membership.workspaceId),
  }
  return json(body)
}

/** Admins manage roles only. Roles are read per request, so a change applies on the member's next request. */
export async function setRole(ctx: AuthedContext): Promise<Response> {
  const parsed = RoleBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const message =
      issue?.code === 'unrecognized_keys' ? `Unknown field ${issue.keys.map((k) => `"${k}"`).join(', ')}` : issue?.message ?? 'Invalid request'
    throw invalid(message)
  }
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
