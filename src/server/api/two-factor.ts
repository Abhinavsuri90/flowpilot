import { z } from 'zod'
import { ApiError, forbidden, invalid, json, readJson } from '../http'
import { isLoginThrottled, recordLoginFailure, verifyPassword } from '../auth'
import { deleteSessionsOf, findUserById } from '../accounts'
import { clientIp } from '../config'
import { sendMail } from '../mail'
import { metrics } from '../observability'
import { recordSecondStepFailure, secondStepAllowed } from '../ratelimit'
import { otpauthUri } from '../totp'
import {
  beginSetup,
  checkSecondFactor,
  closeChallenge,
  confirmSetup,
  failChallenge,
  hasPendingSetup,
  isTwoFactorOn,
  openChallenge,
  recoveryCodesLeft,
  replaceRecoveryCodes,
  turnOff,
  twoFactorState,
} from '../twofactor'
import type { SecondStepResult, TwoFactorSetup, TwoFactorStatus } from '../../lib/types'
import type { ApiContext, AuthedContext } from './context'
import { issueSession } from './auth'

// Two-step sign-in with an authenticator app. Signing in is two requests: the
// password answers with a challenge, and the challenge plus a code answers with
// the session. Turning it on or off needs the password again, and a code.

const challengeGone = (message = 'This sign-in expired or had too many wrong codes. Enter your password again.') =>
  new ApiError(401, 'CHALLENGE_EXPIRED', message)

const wrongCode = (message: string) => invalid(message, [{ path: 'code', message: 'That code isn’t right' }], 'INVALID_CODE')

const SecondStepBody = z.object({
  challenge: z.string({ error: 'Sign in with your password first' }).max(128),
  code: z.string({ error: 'Enter the code from your authenticator app' }).max(32),
})

/** POST /api/auth/two-factor: the second step of signing in (a code from the app, or a recovery code). */
export async function completeSignIn({ db, request }: ApiContext): Promise<Response> {
  const parsed = SecondStepBody.safeParse(await readJson(request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Enter the code from your authenticator app')
  const challenge = openChallenge(db, parsed.data.challenge)
  if (!challenge) {
    metrics.secondFactor.inc({ outcome: 'expired' })
    throw challengeGone()
  }
  const allowed = secondStepAllowed(challenge.userId)
  if (!allowed.allowed) {
    metrics.secondFactor.inc({ outcome: 'throttled' })
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Wait a few minutes, then try again, or use a recovery code later.', {
      headers: { 'Retry-After': String(allowed.retryAfterSec) },
    })
  }
  const result = checkSecondFactor(db, challenge.userId, parsed.data.code)
  if (!result.ok) {
    recordSecondStepFailure(challenge.userId)
    const left = failChallenge(db, challenge.tokenHash)
    metrics.secondFactor.inc({ outcome: 'invalid' })
    if (left === 0) throw challengeGone('Too many wrong codes. Enter your password again.')
    throw new ApiError(401, 'INVALID_CODE', `That code isn’t right. Use the newest code in the app (${left} ${left === 1 ? 'try' : 'tries'} left).`, {
      issues: [{ path: 'code', message: 'That code isn’t right' }],
    })
  }
  closeChallenge(db, challenge.tokenHash)
  metrics.secondFactor.inc({ outcome: result.method })
  const { cookie, me } = issueSession(db, request, challenge.userId)
  const body: SecondStepResult = result.method === 'recovery' ? { ...me, recoveryCodesLeft: recoveryCodesLeft(db, challenge.userId) } : me
  return json(body, { headers: { 'Set-Cookie': cookie } })
}

// ----- managing it (browser sessions only) --------------------------------------------

function refuseDemo(ctx: AuthedContext): void {
  if (ctx.user.isDemo) throw forbidden('Demo accounts are shared, so they can’t use two-step sign-in. Create your own account to turn it on.')
}

/** Security changes ask for the password again (and count wrong ones like sign-in does). */
async function confirmPassword(ctx: AuthedContext, password: string): Promise<void> {
  const ip = clientIp(ctx.request)
  if (isLoginThrottled(ctx.user.email, ip)) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong passwords. Try again in 10 minutes.')
  }
  if (!(await verifyPassword(password, findUserById(ctx.db, ctx.user.id)!.password_hash))) {
    recordLoginFailure(ctx.user.email, ip)
    throw invalid('Your password is incorrect', [{ path: 'password', message: 'Your password is incorrect' }])
  }
}

function notify(ctx: AuthedContext, subject: string, text: string): void {
  void sendMail({ to: ctx.user.email, subject, text: `Hi ${ctx.user.displayName},\n\n${text}\n` })
}

/** GET /api/me/two-factor */
export function status(ctx: AuthedContext): Response {
  const body: TwoFactorStatus = { ...twoFactorState(ctx.db, ctx.user.id), available: !ctx.user.isDemo }
  return json(body)
}

/** POST /api/me/two-factor/setup: a new secret for the app; nothing changes until a code confirms it. */
export function setup(ctx: AuthedContext): Response {
  refuseDemo(ctx)
  if (isTwoFactorOn(ctx.db, ctx.user.id)) {
    throw new ApiError(409, 'ALREADY_ON', 'Two-step sign-in is already on. Turn it off first to move it to another app.')
  }
  const secret = beginSetup(ctx.db, ctx.user.id)
  const body: TwoFactorSetup = { secret, uri: otpauthUri(secret, ctx.user.email) }
  return json(body)
}

const EnableBody = z.strictObject({ password: z.string().max(200), code: z.string().max(32) })

/** POST /api/me/two-factor/enable: password + the app's first code → on, with recovery codes shown once. */
export async function enable(ctx: AuthedContext): Promise<Response> {
  refuseDemo(ctx)
  const parsed = EnableBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid('Enter your password and the code from the app')
  if (isTwoFactorOn(ctx.db, ctx.user.id)) throw new ApiError(409, 'ALREADY_ON', 'Two-step sign-in is already on.')
  if (!hasPendingSetup(ctx.db, ctx.user.id)) throw new ApiError(409, 'SETUP_NOT_STARTED', 'Start the setup again to get a QR code.')
  await confirmPassword(ctx, parsed.data.password)
  const confirmed = confirmSetup(ctx.db, ctx.user.id, parsed.data.code)
  if (!confirmed) throw wrongCode('That code isn’t right. Check that the app shows FlowPilot and that your phone’s clock is set automatically.')
  // Devices signed in with the password alone are signed out.
  const signedOut = deleteSessionsOf(ctx.db, ctx.user.id, ctx.user.sessionHash)
  notify(
    ctx,
    'Two-step sign-in is on for your FlowPilot account',
    'Two-step sign-in was just turned on. From now on, signing in asks for a code from your authenticator app as well as your password.\n\nIf this wasn’t you, reset your password now and contact your workspace admin.',
  )
  return json({ enabled: true, recoveryCodes: confirmed.recoveryCodes, signedOutOtherDevices: signedOut })
}

const DisableBody = z.strictObject({ password: z.string().max(200), code: z.string().max(32) })

/** POST /api/me/two-factor/disable: password + a code (from the app or a recovery code) → off. */
export async function disable(ctx: AuthedContext): Promise<Response> {
  const parsed = DisableBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid('Enter your password and a code')
  if (!isTwoFactorOn(ctx.db, ctx.user.id)) throw new ApiError(409, 'NOT_ON', 'Two-step sign-in is already off.')
  await confirmPassword(ctx, parsed.data.password)
  if (!checkSecondFactor(ctx.db, ctx.user.id, parsed.data.code).ok) {
    throw wrongCode('That code isn’t right. Use the newest code in the app, or one of your recovery codes.')
  }
  turnOff(ctx.db, ctx.user.id)
  notify(
    ctx,
    'Two-step sign-in was turned off',
    'Two-step sign-in was just turned off for your FlowPilot account, so signing in needs only your password.\n\nIf this wasn’t you, change your password now and turn two-step sign-in back on.',
  )
  return json({ enabled: false })
}

const PasswordBody = z.strictObject({ password: z.string().max(200) })

/** POST /api/me/two-factor/recovery-codes: ten new codes; the old ones stop working. */
export async function regenerateCodes(ctx: AuthedContext): Promise<Response> {
  const parsed = PasswordBody.safeParse(await readJson(ctx.request))
  if (!parsed.success) throw invalid('Enter your password')
  if (!isTwoFactorOn(ctx.db, ctx.user.id)) throw new ApiError(409, 'NOT_ON', 'Turn on two-step sign-in first.')
  await confirmPassword(ctx, parsed.data.password)
  return json({ recoveryCodes: replaceRecoveryCodes(ctx.db, ctx.user.id) })
}
