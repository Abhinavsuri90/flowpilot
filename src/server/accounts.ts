import { randomInt } from 'node:crypto'
import type { DB } from './db'
import { hashToken, newToken } from './auth'
import { newId, nowIso } from './ids'
import { recordEvent } from './events'
import type { Role } from '../lib/types'

// People, workspaces, invitations and password resets. Handlers check who may
// do what (lib/policy.ts); these functions only read and write.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const RESET_TTL_MS = 60 * 60 * 1000
/** An invite link without an email can be used this many times by default. */
export const OPEN_INVITE_USES = 25

export type UserRecord = { id: string; email: string; display_name: string; password_hash: string; is_demo: 0 | 1 }

export function findUserByEmail(db: DB, email: string): UserRecord | undefined {
  return db.prepare('SELECT id, email, display_name, password_hash, is_demo FROM users WHERE email = ?').get(email) as UserRecord | undefined
}

export function findUserById(db: DB, id: string): UserRecord | undefined {
  return db.prepare('SELECT id, email, display_name, password_hash, is_demo FROM users WHERE id = ?').get(id) as UserRecord | undefined
}

export function createUser(db: DB, input: { email: string; name: string; passwordHash: string; isDemo?: boolean; hue?: number }): string {
  const id = newId('usr')
  db.prepare('INSERT INTO users (id, email, display_name, password_hash, avatar_hue, is_demo) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    input.email,
    input.name,
    input.passwordHash,
    input.hue ?? randomInt(0, 360),
    input.isDemo ? 1 : 0,
  )
  return id
}

export function setPassword(db: DB, userId: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)
}

export function setDisplayName(db: DB, userId: string, name: string): void {
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId)
}

// ----- workspaces and members ---------------------------------------------------------

/** A new workspace with its creator as the first admin. */
export function createWorkspace(db: DB, name: string, adminId: string): string {
  const id = newId('ws')
  db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(id, name)
  addMember(db, id, adminId, 'admin')
  recordEvent(db, { workspaceId: id, actorId: adminId, type: 'workspace.created', detail: { name } })
  return id
}

export function renameWorkspace(db: DB, workspaceId: string, name: string): void {
  db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, workspaceId)
}

export function addMember(db: DB, workspaceId: string, userId: string, role: Role): void {
  db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(workspaceId, userId, role)
}

export function memberRole(db: DB, workspaceId: string, userId: string): Role | null {
  return (db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').pluck().get(workspaceId, userId) as
    | Role
    | undefined) ?? null
}

export function adminCount(db: DB, workspaceId: string): number {
  return db.prepare(`SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`).pluck().get(workspaceId) as number
}

/** The longest-serving admin other than `exceptUserId` (who inherits recipes when someone leaves). */
export function seniorAdmin(db: DB, workspaceId: string, exceptUserId: string): string | null {
  return (db
    .prepare(
      `SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role = 'admin' AND user_id <> ? ORDER BY joined_at, user_id LIMIT 1`,
    )
    .pluck()
    .get(workspaceId, exceptUserId) as string | undefined) ?? null
}

/**
 * Takes someone out of a workspace. Their recipes there move to `heirId` (a
 * database trigger checks the heir can own recipes), so the team keeps them.
 * Sessions pointed at the workspace fall back to the person's first one.
 */
export function removeMember(db: DB, input: { workspaceId: string; userId: string; heirId: string }): { transferred: number } {
  return db.transaction(() => {
    const transferred = db
      .prepare('UPDATE workflows SET owner_id = @heir, updated_at = @at WHERE workspace_id = @ws AND owner_id = @user')
      .run({ heir: input.heirId, at: nowIso(), ws: input.workspaceId, user: input.userId }).changes
    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(input.workspaceId, input.userId)
    db.prepare('UPDATE sessions SET workspace_id = NULL WHERE user_id = ? AND workspace_id = ?').run(input.userId, input.workspaceId)
    return { transferred }
  })()
}

// ----- sessions ------------------------------------------------------------------------

export function setSessionWorkspace(db: DB, sessionHash: string, workspaceId: string): void {
  db.prepare('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?').run(workspaceId, sessionHash)
}

export type SessionRow = { token_hash: string; created_at: string; last_seen_at: string | null; user_agent: string | null; expires_at: string }

export function listSessions(db: DB, userId: string, now = Date.now()): SessionRow[] {
  return db
    .prepare(
      `SELECT token_hash, created_at, last_seen_at, user_agent, expires_at FROM sessions
        WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    )
    .all(userId, new Date(now).toISOString()) as SessionRow[]
}

/** Signs a person out everywhere except (optionally) one session. */
export function deleteSessionsOf(db: DB, userId: string, exceptHash?: string): number {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(userId, exceptHash ?? null).changes
}

// ----- invitations -------------------------------------------------------------------

export type InviteRow = {
  id: string
  workspace_id: string
  role: Role
  email: string | null
  created_by: string
  created_at: string
  expires_at: string
  max_uses: number
  uses: number
  revoked_at: string | null
}

export function createInvite(
  db: DB,
  input: { workspaceId: string; role: Role; email: string | null; createdBy: string; maxUses?: number; now?: number },
): { invite: InviteRow; token: string } {
  const now = input.now ?? Date.now()
  const token = newToken()
  const invite: InviteRow = {
    id: newId('inv'),
    workspace_id: input.workspaceId,
    role: input.role,
    email: input.email,
    created_by: input.createdBy,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + INVITE_TTL_MS).toISOString(),
    max_uses: input.email ? 1 : (input.maxUses ?? OPEN_INVITE_USES),
    uses: 0,
    revoked_at: null,
  }
  db.prepare(
    `INSERT INTO invites (id, workspace_id, token_hash, role, email, created_by, created_at, expires_at, max_uses)
     VALUES (@id, @workspace_id, @token_hash, @role, @email, @created_by, @created_at, @expires_at, @max_uses)`,
  ).run({ ...invite, token_hash: hashToken(token) })
  return { invite, token }
}

/** The invite for a link token if it can still be used; undefined otherwise (expired, revoked, used up or unknown). */
export function usableInvite(db: DB, token: string, now = Date.now()): InviteRow | undefined {
  if (!token || token.length > 128) return undefined
  const invite = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(token)) as InviteRow | undefined
  if (!invite || invite.revoked_at || invite.uses >= invite.max_uses || Date.parse(invite.expires_at) <= now) return undefined
  return invite
}

export function useInvite(db: DB, inviteId: string): void {
  db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(inviteId)
}

/** Invites that can still be used, newest first. */
export function pendingInvites(db: DB, workspaceId: string, now = Date.now()): InviteRow[] {
  return db
    .prepare(
      `SELECT * FROM invites WHERE workspace_id = ? AND revoked_at IS NULL AND uses < max_uses AND expires_at > ?
        ORDER BY created_at DESC, id`,
    )
    .all(workspaceId, new Date(now).toISOString()) as InviteRow[]
}

export function revokeInvite(db: DB, workspaceId: string, inviteId: string): boolean {
  return (
    db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL').run(nowIso(), inviteId, workspaceId)
      .changes > 0
  )
}

// ----- password resets ----------------------------------------------------------------

export function createPasswordReset(db: DB, userId: string, now = Date.now()): string {
  const token = newToken()
  // One live link per person: a new request replaces older ones.
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId)
  db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + RESET_TTL_MS).toISOString(),
  )
  return token
}

/** The user a reset link belongs to, if the link is unused and unexpired. */
export function usableReset(db: DB, token: string, now = Date.now()): { userId: string; tokenHash: string } | undefined {
  if (!token || token.length > 128) return undefined
  const tokenHash = hashToken(token)
  const row = db.prepare('SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?').get(tokenHash) as
    | { user_id: string; expires_at: string; used_at: string | null }
    | undefined
  if (!row || row.used_at || Date.parse(row.expires_at) <= now) return undefined
  return { userId: row.user_id, tokenHash }
}

export function markResetUsed(db: DB, tokenHash: string): void {
  db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash)
}
