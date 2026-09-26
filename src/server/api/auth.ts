import { z } from 'zod'
import {
  clearLoginFailures,
  clearedSessionCookie,
  createSession,
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
import { modelStatus } from '../ai/config'
import { ApiError, invalid, isSecureRequest, json, readJson } from '../http'
import type { Me } from '../../lib/types'
import type { AuthedContext, ApiContext } from './context'

const LoginBody = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
})

export function toMe(user: SessionUser): Me {
  return {
    user: { id: user.id, email: user.email, name: user.displayName, hue: user.avatarHue },
    memberships: user.memberships,
    workspace: user.memberships[0] ?? null,
    model: modelStatus(),
  }
}

export async function login({ request, db }: ApiContext): Promise<Response> {
  const parsed = LoginBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid('Enter your email and password.')
  const { email, password } = parsed.data

  if (isLoginThrottled(email)) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts for this email. Try again in 10 minutes.')
  }

  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; password_hash: string }
    | undefined
  // Always run scrypt, even for unknown emails, so timing doesn't reveal accounts.
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()))
  if (!row || !ok) {
    recordLoginFailure(email)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
  }

  clearLoginFailures(email)
  // Signing in replaces whatever session this browser had, and tidies expired ones.
  const previous = readCookie(request, SESSION_COOKIE)
  if (previous) deleteSession(db, previous)
  purgeExpiredSessions(db)
  const { token, expiresAt } = createSession(db, row.id)
  const cookie = sessionCookie(token, expiresAt, isSecureRequest(request))
  const user = userFromRequest(db, new Request(request.url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))
  return json(toMe(user!), { headers: { 'Set-Cookie': cookie } })
}

export function logout({ request, db }: ApiContext): Response {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) deleteSession(db, token)
  return json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie(isSecureRequest(request)) } })
}

export function me({ user }: AuthedContext): Response {
  return json(toMe(user))
}
