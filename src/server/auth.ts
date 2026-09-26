import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import type { DB } from './db'
import type { Membership, Role } from '../lib/types'

// ---------------------------------------------------------------------------
// Passwords: scrypt (N = 16384, r = 8, p = 1) with a random 16-byte salt,
// stored as `scrypt$<salt>$<hash>` (base64).
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions
const KEY_LENGTH = 64

function scrypt(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length === 0) return false
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

let dummyHash: Promise<string> | null = null
/** A real hash to verify against for unknown emails, so timing doesn't reveal which accounts exist. */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(18).toString('base64'))
  return dummyHash
}

// ---------------------------------------------------------------------------
// Sessions: a 256-bit random token in an HttpOnly cookie. Only its SHA-256
// is stored, so a database leak does not leak usable sessions.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'fp_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Personal API tokens start with this, so a leaked one is recognisable in logs and scanners. */
export const API_TOKEN_PREFIX = 'fp_'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A random URL-safe secret (sessions, invite links, reset links); only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createSession(
  db: DB,
  userId: string,
  opts: { workspaceId?: string | null; userAgent?: string | null; now?: number } = {},
): { token: string; expiresAt: string } {
  const now = opts.now ?? Date.now()
  const token = newToken()
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()
  const at = new Date(now).toISOString()
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, workspace_id, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, at, expiresAt, opts.workspaceId ?? null, opts.userAgent?.slice(0, 300) || null, at)
  return { token, expiresAt }
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

/** Expired sessions are useless; remove them (run on each sign-in, so the table can't grow forever). */
export function purgeExpiredSessions(db: DB, now = Date.now()): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString()).changes
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim()
      return value || null
    }
  }
  return null
}

export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ')
}

export type SessionUser = {
  id: string
  email: string
  displayName: string
  avatarHue: number
  memberships: Membership[]
  /** The workspace this browser works in (a membership id), or null for the first one. */
  activeWorkspaceId: string | null
  /** Shared demo accounts can't change their password, name or memberships. */
  isDemo: boolean
  /** Hash of this request's session token (identifies "this device"); empty for API tokens. */
  sessionHash: string
  /** A browser session, or a personal API token (which can't touch account or security settings). */
  via: 'session' | 'token'
}

type UserRow = { id: string; email: string; display_name: string; avatar_hue: number; is_demo: 0 | 1 }

/** How often a session's last_seen_at is refreshed (a write), at most. */
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000

export function membershipsFor(db: DB, userId: string): Membership[] {
  const rows = db
    .prepare(
      `SELECT m.workspace_id, w.name AS workspace_name, m.role
         FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY m.joined_at, w.name`,
    )
    .all(userId) as { workspace_id: string; workspace_name: string; role: Role }[]
  return rows.map((r) => ({ workspaceId: r.workspace_id, workspaceName: r.workspace_name, role: r.role }))
}

/**
 * Resolves the caller: a personal API token in `Authorization: Bearer fp_…`,
 * else the session cookie, else null. Roles are read fresh on every call.
 */
export function userFromRequest(db: DB, request: Request, now = Date.now()): SessionUser | null {
  const authorization = request.headers.get('authorization')
  if (authorization) return userFromBearer(db, request, authorization, now)
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || token.length > 128) return null
  const sessionHash = hashToken(token)
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_hue, u.is_demo, s.expires_at, s.workspace_id, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sessionHash) as (UserRow & { expires_at: string; workspace_id: string | null; last_seen_at: string | null }) | undefined
  if (!row) return null
  if (Date.parse(row.expires_at) <= now) {
    deleteSession(db, token)
    return null
  }
  if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > LAST_SEEN_EVERY_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), sessionHash)
  }
  const memberships = membershipsFor(db, row.id)
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarHue: row.avatar_hue,
    memberships,
    // A workspace you've left falls back to your first one.
    activeWorkspaceId: memberships.some((m) => m.workspaceId === row.workspace_id) ? row.workspace_id : null,
    isDemo: row.is_demo === 1,
    sessionHash,
    via: 'session',
  }
}

type TokenRow = UserRow & { expires_at: string; revoked_at: string | null; last_used_at: string | null }

/** A script's user from its API token: unrevoked, unexpired, hash-matched; works in its first workspace unless X-Workspace-Id names another. */
function userFromBearer(db: DB, request: Request, authorization: string, now: number): SessionUser | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  const secret = match?.[1]
  if (!secret || !secret.startsWith(API_TOKEN_PREFIX) || secret.length > 128) return null
  const hash = hashToken(secret)
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_hue, u.is_demo, t.expires_at, t.revoked_at, t.last_used_at
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?`,
    )
    .get(hash) as TokenRow | undefined
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= now) return null
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > LAST_SEEN_EVERY_MS) {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), hash)
  }
  const memberships = membershipsFor(db, row.id)
  const wanted = request.headers.get('x-workspace-id')?.trim() || null
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarHue: row.avatar_hue,
    memberships,
    activeWorkspaceId: wanted && memberships.some((m) => m.workspaceId === wanted) ? wanted : null,
    isDemo: row.is_demo === 1,
    sessionHash: '',
    via: 'token',
  }
}

/** The membership requests act in: the session's workspace, else the first one. */
export function currentMembership(user: Pick<SessionUser, 'memberships' | 'activeWorkspaceId'>): Membership | null {
  return user.memberships.find((m) => m.workspaceId === user.activeWorkspaceId) ?? user.memberships[0] ?? null
}

// ---------------------------------------------------------------------------
// Login throttling. Failures are counted three ways:
//   - per email and address: 10 in 10 minutes (stops one attacker quickly);
//   - per email from anywhere: 50 (a distributed attack on one account);
//   - per address across emails: 100 (password spraying).
// So one attacker can't lock someone else out just by knowing their email.
// Kept in memory for a single server; a shared store (Redis) at scale.
// ---------------------------------------------------------------------------

export const LOGIN_WINDOW_MS = 10 * 60 * 1000
export const LOGIN_LIMITS = { pair: 10, email: 50, address: 100 } as const
const failures = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS)
  if (kept.length) failures.set(key, kept)
  else failures.delete(key)
  return kept
}

const keys = (email: string, ip: string) => {
  const e = email.toLowerCase()
  return { pair: `pair:${e}|${ip}`, email: `email:${e}`, address: `ip:${ip}` }
}

export function isLoginThrottled(email: string, ip = 'unknown', now = Date.now()): boolean {
  const k = keys(email, ip)
  return (
    recent(k.pair, now).length >= LOGIN_LIMITS.pair ||
    recent(k.email, now).length >= LOGIN_LIMITS.email ||
    recent(k.address, now).length >= LOGIN_LIMITS.address
  )
}

export function recordLoginFailure(email: string, ip = 'unknown', now = Date.now()): void {
  for (const key of Object.values(keys(email, ip))) {
    const list = recent(key, now)
    list.push(now)
    failures.set(key, list)
  }
}

/** A successful sign-in clears that person's own counter (not the global ones). */
export function clearLoginFailures(email: string, ip = 'unknown'): void {
  failures.delete(keys(email, ip).pair)
}

export function resetLoginThrottle(): void {
  failures.clear()
}
