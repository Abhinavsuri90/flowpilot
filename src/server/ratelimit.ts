// In-memory sliding-window limits. A shared store (Redis) at scale.

export type Limiter = {
  /** Records a hit if allowed; otherwise says how long to wait. */
  take(key: string, now?: number): { allowed: true } | { allowed: false; retryAfterSec: number }
  reset(): void
}

export function slidingWindow(limit: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>()
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0]!)) / 1000)) }
      }
      recent.push(now)
      hits.set(key, recent)
      return { allowed: true }
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

export function takeGenerateBudget(userId: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSec: number } {
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

export function resetAccountLimits(): void {
  registrations.reset()
  resetsByEmail.reset()
  resetsByAddress.reset()
}
