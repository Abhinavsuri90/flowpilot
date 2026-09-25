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

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: DB, userId: string, now = Date.now()): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    expiresAt,
  )
  return { token, expiresAt }
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
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
}

type UserRow = { id: string; email: string; display_name: string; avatar_hue: number }

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

/** Resolves the signed-in user from the session cookie, or null. Roles are read fresh on every call. */
export function userFromRequest(db: DB, request: Request, now = Date.now()): SessionUser | null {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || token.length > 128) return null
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_hue, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as (UserRow & { expires_at: string }) | undefined
  if (!row) return null
  if (Date.parse(row.expires_at) <= now) {
    deleteSession(db, token)
    return null
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarHue: row.avatar_hue,
    memberships: membershipsFor(db, row.id),
  }
}

// ---------------------------------------------------------------------------
// Login throttling: 10 failures per email per 10 minutes → 429.
// Kept in memory for the prototype; a shared store (Redis) at scale.
// ---------------------------------------------------------------------------

export const LOGIN_WINDOW_MS = 10 * 60 * 1000
export const LOGIN_MAX_FAILURES = 10
const failures = new Map<string, number[]>()

function recent(email: string, now: number): number[] {
  const key = email.toLowerCase()
  const kept = (failures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS)
  if (kept.length) failures.set(key, kept)
  else failures.delete(key)
  return kept
}

export function isLoginThrottled(email: string, now = Date.now()): boolean {
  return recent(email, now).length >= LOGIN_MAX_FAILURES
}

export function recordLoginFailure(email: string, now = Date.now()): void {
  const list = recent(email, now)
  list.push(now)
  failures.set(email.toLowerCase(), list)
}

export function clearLoginFailures(email: string): void {
  failures.delete(email.toLowerCase())
}

export function resetLoginThrottle(): void {
  failures.clear()
}
