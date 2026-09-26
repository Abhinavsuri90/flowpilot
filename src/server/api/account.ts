import { z } from 'zod'
import { ApiError, forbidden, invalid, json, notFound, readJson } from '../http'
import { clearLoginFailures, hashPassword, isLoginThrottled, recordLoginFailure, verifyPassword } from '../auth'
import {
  addMember,
  createPasswordReset,
  createUser,
  createWorkspace,
  deleteSessionsOf,
  findUserByEmail,
  findUserById,
  listSessions,
  markResetUsed,
  setDisplayName,
  setPassword,
  setSessionWorkspace,
  usableInvite,
  usableReset,
  useInvite,
} from '../accounts'
import { absoluteUrl, appConfig, clientIp } from '../config'
import { recordEvent } from '../events'
import { sendMail } from '../mail'
import { takePasswordReset, takeRegistration } from '../ratelimit'
import { emailProblem, nameProblem, normalizeEmail, passwordProblem, workspaceNameProblem } from '../../lib/account'
import type { ApiIssue, SessionInfo } from '../../lib/types'
import type { ApiContext, AuthedContext } from './context'
import { issueSession, toMe } from './auth'

export const inviteGone = () =>
  new ApiError(404, 'INVITE_INVALID', 'This invite link has expired, was revoked or was already used. Ask for a new one.')
const resetGone = () => new ApiError(404, 'RESET_INVALID', 'This reset link has expired or was already used. Request a new one.')

function throttled(retryAfterSec: number, message: string): ApiError {
  return new ApiError(429, 'RATE_LIMITED', message, { headers: { 'Retry-After': String(retryAfterSec) } })
}

function failIfIssues(issues: ApiIssue[]): void {
  if (issues.length) throw invalid(issues[0]!.message, issues)
}

/** "a•••@company.com": enough to recognise an address without spelling it out. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}

// ----- sign up ------------------------------------------------------------------------

const RegisterBody = z.object({
  name: z.string({ error: 'Enter your name' }),
  email: z.string({ error: 'Enter your email address' }),
  password: z.string({ error: 'Choose a password' }),
  workspaceName: z.string().optional(),
  inviteToken: z.string().max(128).optional(),
})

/**
 * POST /api/auth/register. Without an invite it creates a workspace with you as
 * its admin; with one, you join that workspace in the invited role.
 */
export async function register({ db, request }: ApiContext): Promise<Response> {
  const config = appConfig()
  if (config.registration === 'closed') {
    throw forbidden('New accounts can’t be created on this server. Ask whoever runs it for access.')
  }
  const budget = takeRegistration(clientIp(request))
  if (!budget.allowed) throw throttled(budget.retryAfterSec, 'Too many accounts were created from here recently. Try again later.')

  const parsed = RegisterBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Fill in every field')
  const name = parsed.data.name.trim()
  const email = normalizeEmail(parsed.data.email)
  const password = parsed.data.password
  const workspaceName = parsed.data.workspaceName?.trim() ?? ''

  const invite = parsed.data.inviteToken ? usableInvite(db, parsed.data.inviteToken) : undefined
  if (parsed.data.inviteToken && !invite) throw inviteGone()
  if (!invite && config.registration === 'invite-only') throw forbidden('This server is invite-only. Ask an admin for an invite link.')

  const issues: ApiIssue[] = []
  const nameIssue = nameProblem(name)
  if (nameIssue) issues.push({ path: 'name', message: nameIssue })
  const emailIssue = emailProblem(email)
  if (emailIssue) issues.push({ path: 'email', message: emailIssue })
  const passwordIssue = passwordProblem(password, { email, name })
  if (passwordIssue) issues.push({ path: 'password', message: passwordIssue })
  if (!invite) {
    const wsIssue = workspaceNameProblem(workspaceName)
    if (wsIssue) issues.push({ path: 'workspaceName', message: wsIssue })
  }
  failIfIssues(issues)

  if (invite?.email && invite.email.toLowerCase() !== email) {
    throw forbidden(`This invite is for ${maskEmail(invite.email)}. Sign up with that address, or ask for a new link.`)
  }
  if (findUserByEmail(db, email)) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.', {
      issues: [{ path: 'email', message: 'An account with this email already exists' }],
    })
  }

  const passwordHash = await hashPassword(password)
  const { userId, workspaceId } = db.transaction(() => {
    const userId = createUser(db, { email, name, passwordHash })
    if (invite) {
      addMember(db, invite.workspace_id, userId, invite.role)
      useInvite(db, invite.id)
      recordEvent(db, { workspaceId: invite.workspace_id, actorId: userId, type: 'member.joined', detail: { role: invite.role, via: 'invite' } })
      return { userId, workspaceId: invite.workspace_id }
    }
    return { userId, workspaceId: createWorkspace(db, workspaceName, userId) }
  })()

  const { cookie, me } = issueSession(db, request, userId, workspaceId)
  return json(me, { status: 201, headers: { 'Set-Cookie': cookie } })
}

// ----- password reset -----------------------------------------------------------------

const ForgotBody = z.object({ email: z.string({ error: 'Enter your email address' }) })
const RESET_SENT = 'If an account exists for that email, a link to reset the password is on its way. It works for one hour.'

/** POST /api/auth/forgot: always the same answer, so it can't be used to find accounts. */
export async function forgotPassword({ db, request }: ApiContext): Promise<Response> {
  const parsed = ForgotBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Enter your email address')
  const email = normalizeEmail(parsed.data.email)
  const problem = emailProblem(email)
  if (problem) throw invalid(problem, [{ path: 'email', message: problem }])

  const budget = takePasswordReset(email, clientIp(request))
  if (!budget.allowed) throw throttled(budget.retryAfterSec, 'Too many reset requests. Try again later.')

  const user = findUserByEmail(db, email)
  if (user && user.is_demo === 0) {
    const token = createPasswordReset(db, user.id)
    const link = absoluteUrl(request, `/reset-password/${token}`)
    // Not awaited: sending takes time only when the account exists, and timing must not tell.
    void sendMail({
      to: user.email,
      subject: 'Reset your FlowPilot password',
      text: `Hi ${user.display_name},\n\nSomeone (hopefully you) asked to reset your FlowPilot password. Open this link within an hour to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays the same.\n`,
    })
  }
  return json({ ok: true, message: RESET_SENT })
}

/** GET /api/auth/reset/:token: is this link still good (and for whom, masked)? */
export function resetInfo({ db, params }: ApiContext): Response {
  const reset = usableReset(db, params.token!)
  const user = reset && findUserById(db, reset.userId)
  if (!user) throw resetGone()
  return json({ email: maskEmail(user.email) })
}

const ResetBody = z.object({ token: z.string().max(128), password: z.string({ error: 'Choose a password' }) })

/** POST /api/auth/reset: sets the new password, signs out every device, and signs this one in. */
export async function resetPassword({ db, request }: ApiContext): Promise<Response> {
  const parsed = ResetBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Choose a password')
  const reset = usableReset(db, parsed.data.token)
  const user = reset && findUserById(db, reset.userId)
  if (!reset || !user) throw resetGone()
  const problem = passwordProblem(parsed.data.password, { email: user.email, name: user.display_name })
  if (problem) throw invalid(problem, [{ path: 'password', message: problem }])

  const passwordHash = await hashPassword(parsed.data.password)
  db.transaction(() => {
    setPassword(db, user.id, passwordHash)
    markResetUsed(db, reset.tokenHash)
    deleteSessionsOf(db, user.id)
  })()
  clearLoginFailures(user.email, clientIp(request))
  const { cookie, me } = issueSession(db, request, user.id)
  return json(me, { headers: { 'Set-Cookie': cookie } })
}

// ----- your account -------------------------------------------------------------------

const ProfileBody = z.strictObject({ name: z.string({ error: 'Enter your name' }) })

/** PATCH /api/me: your display name. */
export async function updateMe(ctx: AuthedContext): Promise<Response> {
  const parsed = ProfileBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Enter your name')
  if (ctx.user.isDemo) throw forbidden('Demo accounts keep their names')
  const name = parsed.data.name.trim()
  const problem = nameProblem(name)
  if (problem) throw invalid(problem, [{ path: 'name', message: problem }])
  setDisplayName(ctx.db, ctx.user.id, name)
  return json(toMe({ ...ctx.user, displayName: name }))
}

const PasswordBody = z.strictObject({ currentPassword: z.string().max(200), newPassword: z.string().max(400) })

/** POST /api/me/password: needs the current password; signs out your other devices. */
export async function changePassword(ctx: AuthedContext): Promise<Response> {
  const parsed = PasswordBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid('Enter your current and new password')
  if (ctx.user.isDemo) throw forbidden('Demo accounts keep the documented password')
  const ip = clientIp(ctx.request)
  if (isLoginThrottled(ctx.user.email, ip)) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong passwords. Try again in 10 minutes.')
  }
  const stored = findUserById(ctx.db, ctx.user.id)!.password_hash
  if (!(await verifyPassword(parsed.data.currentPassword, stored))) {
    recordLoginFailure(ctx.user.email, ip)
    throw invalid('Your current password is incorrect', [{ path: 'currentPassword', message: 'Your current password is incorrect' }])
  }
  const next = parsed.data.newPassword
  const problem = passwordProblem(next, { email: ctx.user.email, name: ctx.user.displayName })
  if (problem) throw invalid(problem, [{ path: 'newPassword', message: problem }])
  if (await verifyPassword(next, stored)) {
    throw invalid('Choose a new password, different from the current one', [{ path: 'newPassword', message: 'That is your current password' }])
  }
  setPassword(ctx.db, ctx.user.id, await hashPassword(next))
  const signedOut = deleteSessionsOf(ctx.db, ctx.user.id, ctx.user.sessionHash)
  return json({ ok: true, signedOutOtherDevices: signedOut })
}

/** A short, human label for a browser's user agent ("Chrome on macOS"). */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /node|undici|curl/i.test(userAgent)
            ? 'A script'
            : 'A browser'
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
  return os ? `${browser} on ${os}` : browser
}

/** GET /api/me/sessions: where you're signed in. */
export function sessions(ctx: AuthedContext): Response {
  const list: SessionInfo[] = listSessions(ctx.db, ctx.user.id).map((s) => ({
    id: s.token_hash.slice(0, 12),
    current: s.token_hash === ctx.user.sessionHash,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    device: describeDevice(s.user_agent),
  }))
  return json({ sessions: list })
}

/** DELETE /api/me/sessions: sign out everywhere except this browser. */
export function signOutOthers(ctx: AuthedContext): Response {
  return json({ signedOut: deleteSessionsOf(ctx.db, ctx.user.id, ctx.user.sessionHash) })
}

// ----- workspaces -------------------------------------------------------------------

const SwitchBody = z.strictObject({ workspaceId: z.string().min(1).max(64) })

/** POST /api/me/workspace: work in another of your workspaces (this browser only). */
export async function switchWorkspace(ctx: AuthedContext): Promise<Response> {
  const parsed = SwitchBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid('Choose a workspace')
  const membership = ctx.user.memberships.find((m) => m.workspaceId === parsed.data.workspaceId)
  if (!membership) throw notFound('That workspace')
  setSessionWorkspace(ctx.db, ctx.user.sessionHash, membership.workspaceId)
  return json(toMe({ ...ctx.user, activeWorkspaceId: membership.workspaceId }))
}

const CreateWorkspaceBody = z.strictObject({ name: z.string({ error: 'Give the workspace a name' }) })

/** POST /api/workspaces: a new workspace with you as admin; this browser switches to it. */
export async function createWorkspaceHandler(ctx: AuthedContext): Promise<Response> {
  const parsed = CreateWorkspaceBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Give the workspace a name')
  const name = parsed.data.name.trim()
  const problem = workspaceNameProblem(name)
  if (problem) throw invalid(problem, [{ path: 'name', message: problem }])
  if (ctx.user.memberships.length >= 20) throw forbidden('You can belong to at most 20 workspaces')
  const workspaceId = createWorkspace(ctx.db, name, ctx.user.id)
  setSessionWorkspace(ctx.db, ctx.user.sessionHash, workspaceId)
  const memberships = [...ctx.user.memberships, { workspaceId, workspaceName: name, role: 'admin' as const }]
  return json(toMe({ ...ctx.user, memberships, activeWorkspaceId: workspaceId }), { status: 201 })
}
