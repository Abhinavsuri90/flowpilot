// In-memory sliding-window limits. A shared store (Redis) at scale.

export type Verdict = { allowed: true } | { allowed: false; retryAfterSec: number }

export type Limiter = {
  /** Records a hit if allowed; otherwise says how long to wait. */
  take(key: string, now?: number): Verdict
  /** Says whether a hit would be allowed, without recording one. */
  check(key: string, now?: number): Verdict
  reset(): void
}

export function slidingWindow(limit: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>()
  const verdict = (key: string, now: number): { recent: number[]; verdict: Verdict } => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      return { recent, verdict: { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0]!)) / 1000)) } }
    }
    return { recent, verdict: { allowed: true } }
  }
  return {
    take(key, now = Date.now()) {
      const { recent, verdict: result } = verdict(key, now)
      if (result.allowed) recent.push(now)
      hits.set(key, recent)
      return result
    },
    check(key, now = Date.now()) {
      return verdict(key, now).verdict
    },
    reset() {
      hits.clear()
    },
  }
}

/** AI drafting costs money per call, so each person gets a modest budget. */
export const GENERATE_LIMITS = { perMinute: 10, perDay: 200 } as const
const perMinute = slidingWindow(GENERATE_LIMITS.perMinute, 60_000)
const perDay = slidingWindow(GENERATE_LIMITS.perDay, 24 * 60 * 60_000)

export function takeGenerateBudget(userId: string, now = Date.now()): Verdict {
  const day = perDay.take(userId, now)
  if (!day.allowed) return day
  return perMinute.take(userId, now)
}

export function resetGenerateLimits(): void {
  perMinute.reset()
  perDay.reset()
}

// Account endpoints that anyone can call, keyed by address (see clientIp) and
// email. Generous for people, tight enough to stop scripted abuse.
export const ACCOUNT_LIMITS = { registrationsPerHour: 20, resetsPerEmailPerHour: 3, resetsPerAddressPerHour: 20 } as const
const registrations = slidingWindow(ACCOUNT_LIMITS.registrationsPerHour, 60 * 60_000)
const resetsByEmail = slidingWindow(ACCOUNT_LIMITS.resetsPerEmailPerHour, 60 * 60_000)
const resetsByAddress = slidingWindow(ACCOUNT_LIMITS.resetsPerAddressPerHour, 60 * 60_000)

export function takeRegistration(address: string, now = Date.now()) {
  return registrations.take(address, now)
}

export function takePasswordReset(email: string, address: string, now = Date.now()) {
  const byAddress = resetsByAddress.take(address, now)
  if (!byAddress.allowed) return byAddress
  return resetsByEmail.take(email.toLowerCase(), now)
}

// Wrong codes at the second step of signing in, per person across challenges:
// each challenge allows five tries, and this stops someone who knows the password
// from starting challenge after challenge to guess a 6-digit code.
export const SECOND_STEP_LIMITS = { failures: 10, windowMs: 10 * 60_000 } as const
const secondStepFailures = slidingWindow(SECOND_STEP_LIMITS.failures, SECOND_STEP_LIMITS.windowMs)

export function secondStepAllowed(userId: string, now = Date.now()): Verdict {
  return secondStepFailures.check(userId, now)
}

export function recordSecondStepFailure(userId: string, now = Date.now()): void {
  secondStepFailures.take(userId, now)
}

export function resetAccountLimits(): void {
  registrations.reset()
  resetsByEmail.reset()
  resetsByAddress.reset()
  secondStepFailures.reset()
}
