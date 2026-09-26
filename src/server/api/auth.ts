import { z } from 'zod'
import {
  clearLoginFailures,
  clearedSessionCookie,
  createSession,
  currentMembership,
  deleteSession,
  dummyPasswordHash,
  isLoginThrottled,
  purgeExpiredSessions,
  readCookie,
  recordLoginFailure,
  SESSION_COOKIE,
  sessionCookie,
  userFromRequest,
  verifyPassword,
  type SessionUser,
} from '../auth'
import { clientIp } from '../config'
import { modelStatus } from '../ai/config'
import { ApiError, invalid, isSecureRequest, json, readJson } from '../http'
import type { DB } from '../db'
import type { Me } from '../../lib/types'
import type { AuthedContext, ApiContext } from './context'

const LoginBody = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
})

export function toMe(user: SessionUser): Me {
  return {
    user: { id: user.id, email: user.email, name: user.displayName, hue: user.avatarHue, isDemo: user.isDemo },
    memberships: user.memberships,
    workspace: currentMembership(user),
    model: modelStatus(),
  }
}

/**
 * Signs `userId` in on this browser: replaces any session the browser had,
 * tidies expired ones, and returns the cookie plus the new `Me`.
 */
export function issueSession(db: DB, request: Request, userId: string, workspaceId: string | null = null): { cookie: string; me: Me } {
  const previous = readCookie(request, SESSION_COOKIE)
  if (previous) deleteSession(db, previous)
  purgeExpiredSessions(db)
  const { token, expiresAt } = createSession(db, userId, { workspaceId, userAgent: request.headers.get('user-agent') })
  const user = userFromRequest(db, new Request(request.url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))!
  return { cookie: sessionCookie(token, expiresAt, isSecureRequest(request)), me: toMe(user) }
}

export async function login({ request, db }: ApiContext): Promise<Response> {
  const parsed = LoginBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid('Enter your email and password.')
  const { email, password } = parsed.data
  const ip = clientIp(request)

  if (isLoginThrottled(email, ip)) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again in 10 minutes, or reset your password.')
  }

  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; password_hash: string }
    | undefined
  // Always run scrypt, even for unknown emails, so timing doesn't reveal accounts.
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()))
  if (!row || !ok) {
    recordLoginFailure(email, ip)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
  }

  clearLoginFailures(email, ip)
  const { cookie, me } = issueSession(db, request, row.id)
  return json(me, { headers: { 'Set-Cookie': cookie } })
}

export function logout({ request, db }: ApiContext): Response {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) deleteSession(db, token)
  return json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie(isSecureRequest(request)) } })
}

export function me({ user }: AuthedContext): Response {
  return json(toMe(user))
}
