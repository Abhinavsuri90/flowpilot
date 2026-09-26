import { z } from 'zod'
import { ApiError, forbidden, invalid, json, notFound, readJson } from '../http'
import { currentMembership, userFromRequest } from '../auth'
import { addMember, createInvite, pendingInvites, revokeInvite, setSessionWorkspace, usableInvite, useInvite, type InviteRow } from '../accounts'
import { absoluteUrl, appConfig } from '../config'
import { recordEvent } from '../events'
import { sendMail } from '../mail'
import { userRef, workspaceName } from '../repo'
import { canManageMembers } from '../../lib/policy'
import { emailProblem, normalizeEmail } from '../../lib/account'
import type { InviteInfo, InviteLanding, Membership } from '../../lib/types'
import type { ApiContext, AuthedContext } from './context'
import { inviteGone } from './account'
import { toMe } from './auth'

function adminMembership(ctx: AuthedContext): Membership {
  const membership = currentMembership(ctx.user)
  if (!membership) throw notFound('That workspace')
  if (!canManageMembers(membership.role)) throw forbidden('Only admins can invite people')
  return membership
}

function toInviteInfo(ctx: AuthedContext, invite: InviteRow): InviteInfo {
  return {
    id: invite.id,
    role: invite.role,
    email: invite.email,
    createdBy: userRef(ctx.db, invite.created_by),
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    uses: invite.uses,
    maxUses: invite.max_uses,
  }
}

/** GET /api/workspace/invites: links that can still be used (admins). */
export function list(ctx: AuthedContext): Response {
  const membership = adminMembership(ctx)
  return json({ invites: pendingInvites(ctx.db, membership.workspaceId).map((i) => toInviteInfo(ctx, i)) })
}

const CreateBody = z.strictObject({
  role: z.enum(['admin', 'member', 'viewer'], { error: 'Role must be admin, member or viewer' }),
  email: z.string().max(254).optional(),
})

/**
 * POST /api/workspace/invites: a link to join the workspace in a role. With an
 * email it works once, for that address only (and is emailed when mail is set up);
 * without one, anyone with the link can join, up to 25 times, for 7 days.
 */
export async function create(ctx: AuthedContext): Promise<Response> {
  const membership = adminMembership(ctx)
  if (ctx.user.isDemo) throw forbidden('Demo accounts can’t invite people. Create your own account to invite your team.')
  const parsed = CreateBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalid(issue?.code === 'unrecognized_keys' ? `Unknown field ${issue.keys.map((k) => `"${k}"`).join(', ')}` : issue?.message ?? 'Invalid invite')
  }
  const email = parsed.data.email?.trim() ? normalizeEmail(parsed.data.email) : null
  if (email) {
    const problem = emailProblem(email)
    if (problem) throw invalid(problem, [{ path: 'email', message: problem }])
    const member = ctx.db
      .prepare('SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?')
      .get(membership.workspaceId, email)
    if (member) throw new ApiError(409, 'ALREADY_MEMBER', `${email} is already a member of ${membership.workspaceName}.`)
  }
  if (pendingInvites(ctx.db, membership.workspaceId).length >= 100) throw forbidden('Revoke some pending invites before creating more')

  const { invite, token } = createInvite(ctx.db, { workspaceId: membership.workspaceId, role: parsed.data.role, email, createdBy: ctx.user.id })
  const link = absoluteUrl(ctx.request, `/invite/${token}`)
  recordEvent(ctx.db, { workspaceId: membership.workspaceId, actorId: ctx.user.id, type: 'invite.created', detail: { role: invite.role, email } })
  let emailed = false
  if (email) {
    void sendMail({
      to: email,
      subject: `${ctx.user.displayName} invited you to ${membership.workspaceName} on FlowPilot`,
      text: `${ctx.user.displayName} invited you to join ${membership.workspaceName} on FlowPilot as a ${invite.role}.\n\nFlowPilot turns repetitive CSV reports into recipes your team can rerun on their own files.\n\nAccept the invitation (the link works for 7 days):\n${link}\n`,
    })
    emailed = appConfig().mail !== null
  }
  return json({ invite: toInviteInfo(ctx, invite), link, emailed }, { status: 201 })
}

/** DELETE /api/workspace/invites/:id: the link stops working immediately. */
export function revoke(ctx: AuthedContext): Response {
  const membership = adminMembership(ctx)
  if (!revokeInvite(ctx.db, membership.workspaceId, ctx.params.id!)) throw notFound('That invite')
  recordEvent(ctx.db, { workspaceId: membership.workspaceId, actorId: ctx.user.id, type: 'invite.revoked', detail: { inviteId: ctx.params.id } })
  return json({ revoked: ctx.params.id })
}

/** GET /api/invites/:token (public): what the link is for, so the page can explain it. */
export function info({ db, params, request }: ApiContext): Response {
  const invite = usableInvite(db, params.token!)
  if (!invite) throw inviteGone()
  const viewer = userFromRequest(db, request)
  const inviter = userRef(db, invite.created_by)
  const body: InviteLanding = {
    workspace: { name: workspaceName(db, invite.workspace_id) },
    invitedBy: inviter.name,
    invitedByHue: inviter.hue,
    role: invite.role,
    email: invite.email,
    expiresAt: invite.expires_at,
    viewer: viewer
      ? {
          alreadyMember: viewer.memberships.some((m) => m.workspaceId === invite.workspace_id),
          emailMatches: !invite.email || invite.email.toLowerCase() === viewer.email.toLowerCase(),
        }
      : null,
  }
  return json(body)
}

/** POST /api/invites/:token/accept: join the workspace (or just switch to it if you're already in). */
export function accept(ctx: AuthedContext): Response {
  const invite = usableInvite(ctx.db, ctx.params.token!)
  if (!invite) throw inviteGone()
  if (invite.email && invite.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
    throw forbidden(`This invite is for ${invite.email}. Sign in with that account, or ask for a new link.`)
  }
  if (ctx.user.isDemo) throw forbidden('Demo accounts can’t join other workspaces. Create your own account first.')
  const already = ctx.user.memberships.find((m) => m.workspaceId === invite.workspace_id)
  let memberships = ctx.user.memberships
  if (!already) {
    ctx.db.transaction(() => {
      addMember(ctx.db, invite.workspace_id, ctx.user.id, invite.role)
      useInvite(ctx.db, invite.id)
      recordEvent(ctx.db, { workspaceId: invite.workspace_id, actorId: ctx.user.id, type: 'member.joined', detail: { role: invite.role, via: 'invite' } })
    })()
    memberships = [...memberships, { workspaceId: invite.workspace_id, workspaceName: workspaceName(ctx.db, invite.workspace_id), role: invite.role }]
  }
  setSessionWorkspace(ctx.db, ctx.user.sessionHash, invite.workspace_id)
  return json({ alreadyMember: !!already, me: toMe({ ...ctx.user, memberships, activeWorkspaceId: invite.workspace_id }) })
}
