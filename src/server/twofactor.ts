import type { DB } from './db'
import { hashToken, newToken } from './auth'
import { log } from './observability'
import { seal, unseal } from './secrets'
import { base32Decode, codeKind, hashRecoveryCode, matchTotp, newRecoveryCodes, newTotpSecret } from './totp'

// Two-step sign-in: turning it on and off, recovery codes, and the short-lived
// challenge between a correct password and a correct code. Handlers decide who
// may do what; these functions only read and write.

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const CHALLENGE_MAX_ATTEMPTS = 5

type TotpRow = { totp_secret: string | null; totp_pending_secret: string | null; totp_enabled_at: string | null; totp_last_step: number | null }

function totpRow(db: DB, userId: string): TotpRow | undefined {
  return db.prepare('SELECT totp_secret, totp_pending_secret, totp_enabled_at, totp_last_step FROM users WHERE id = ?').get(userId) as TotpRow | undefined
}

/** Secrets are sealed to their owner, so one can't be copied onto another account. */
const sealContext = (userId: string) => `totp:${userId}`

function readSecret(sealed: string | null, userId: string): Uint8Array | null {
  if (!sealed) return null
  const secret = unseal(sealed, sealContext(userId))
  if (secret === null) {
    // Recovery codes still work: they are hashes, not encrypted.
    log('warn', 'a two-step secret could not be decrypted; did SECRET_KEY or secret.key change?', { userId })
    return null
  }
  return base32Decode(secret)
}

export function isTwoFactorOn(db: DB, userId: string): boolean {
  return !!totpRow(db, userId)?.totp_enabled_at
}

export function recoveryCodesLeft(db: DB, userId: string): number {
  return db.prepare('SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').pluck().get(userId) as number
}

export function twoFactorState(db: DB, userId: string): { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number } {
  const row = totpRow(db, userId)
  return { enabled: !!row?.totp_enabled_at, enabledAt: row?.totp_enabled_at ?? null, recoveryCodesLeft: recoveryCodesLeft(db, userId) }
}

/** Starts (or restarts) setup: a new secret waits until a first correct code confirms it. */
export function beginSetup(db: DB, userId: string): string {
  const secret = newTotpSecret()
  db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(seal(secret, sealContext(userId)), userId)
  return secret
}

export function hasPendingSetup(db: DB, userId: string): boolean {
  return !!totpRow(db, userId)?.totp_pending_secret
}

/** Ten new single-use codes; any older ones stop working. Returned once, stored as hashes. */
export function replaceRecoveryCodes(db: DB, userId: string, now = Date.now()): string[] {
  const codes = newRecoveryCodes()
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
    const insert = db.prepare('INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)')
    for (const code of codes) insert.run(userId, hashRecoveryCode(code), new Date(now).toISOString())
  })()
  return codes
}

/**
 * Confirms setup with a code from the app: the pending secret goes live, that
 * code is spent, and recovery codes are issued. Null when the code is wrong.
 */
export function confirmSetup(db: DB, userId: string, code: string, now = Date.now()): { recoveryCodes: string[] } | null {
  const row = totpRow(db, userId)
  const secret = readSecret(row?.totp_pending_secret ?? null, userId)
  if (!secret) return null
  const step = matchTotp(secret, code.replace(/[\s-]/g, ''), { now })
  if (step === null) return null
  return db.transaction(() => {
    db.prepare(
      `UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE id = ?`,
    ).run(new Date(now).toISOString(), step, userId)
    return { recoveryCodes: replaceRecoveryCodes(db, userId, now) }
  })()
}

export function turnOff(db: DB, userId: string): void {
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?').run(userId)
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM sign_in_challenges WHERE user_id = ?').run(userId)
  })()
}

/**
 * Checks a code typed at the second step: a 6-digit code from the app (spent
 * once accepted, along with every older one) or an unused recovery code (spent
 * now). Both spends are conditional updates, so two requests racing with the
 * same code can't both win.
 */
export function checkSecondFactor(db: DB, userId: string, input: string, now = Date.now()): { ok: true; method: 'totp' | 'recovery' } | { ok: false } {
  const kind = codeKind(input)
  if (kind === 'recovery') {
    const spent = db
      .prepare('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .run(new Date(now).toISOString(), userId, hashRecoveryCode(input)).changes
    return spent === 1 ? { ok: true, method: 'recovery' } : { ok: false }
  }
  if (kind === 'totp') {
    const row = totpRow(db, userId)
    const secret = readSecret(row?.totp_secret ?? null, userId)
    if (!secret) return { ok: false }
    const step = matchTotp(secret, input.replace(/[\s-]/g, ''), { now, afterStep: row!.totp_last_step })
    if (step === null) return { ok: false }
    const spent = db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)').run(step, userId, step).changes
    return spent === 1 ? { ok: true, method: 'totp' } : { ok: false }
  }
  return { ok: false }
}

// ----- sign-in challenges ---------------------------------------------------------------

/** The password was right: a code is still owed. One live challenge per person; only its hash is stored. */
export function createChallenge(db: DB, userId: string, now = Date.now()): { token: string; expiresAt: string } {
  const token = newToken()
  const at = new Date(now).toISOString()
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString()
  db.transaction(() => {
    db.prepare('DELETE FROM sign_in_challenges WHERE user_id = ? OR expires_at <= ?').run(userId, at)
    db.prepare('INSERT INTO sign_in_challenges (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, at, expiresAt)
  })()
  return { token, expiresAt }
}

/** A challenge that can still be answered: known, unexpired, and not out of tries. */
export function openChallenge(db: DB, token: string, now = Date.now()): { tokenHash: string; userId: string } | undefined {
  if (!token || token.length > 128) return undefined
  const tokenHash = hashToken(token)
  const row = db.prepare('SELECT user_id, expires_at, attempts FROM sign_in_challenges WHERE token_hash = ?').get(tokenHash) as
    | { user_id: string; expires_at: string; attempts: number }
    | undefined
  if (!row || Date.parse(row.expires_at) <= now || row.attempts >= CHALLENGE_MAX_ATTEMPTS) return undefined
  return { tokenHash, userId: row.user_id }
}

/** Counts a wrong code and returns the tries left; the challenge is dropped after the last one. */
export function failChallenge(db: DB, tokenHash: string): number {
  const attempts = db.prepare('UPDATE sign_in_challenges SET attempts = attempts + 1 WHERE token_hash = ? RETURNING attempts').pluck().get(tokenHash) as
    | number
    | undefined
  if (attempts === undefined || attempts >= CHALLENGE_MAX_ATTEMPTS) {
    closeChallenge(db, tokenHash)
    return 0
  }
  return CHALLENGE_MAX_ATTEMPTS - attempts
}

export function closeChallenge(db: DB, tokenHash: string): void {
  db.prepare('DELETE FROM sign_in_challenges WHERE token_hash = ?').run(tokenHash)
}
