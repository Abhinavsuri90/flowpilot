import type { Action, Role, Visibility } from './types'

// One set of pure functions decides every permission. The server enforces them
// on every request; the Access page renders its matrix from the same functions.

/** The caller's relation to a recipe: owner or not, and their role in the recipe's workspace (null = outsider). */
export type Relation = { isOwner: boolean; role: Role | null }

export type Decision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; status: 403 | 404 }

/** Owners always see their recipes; workspace members see team-visible ones. */
export function canView(rel: Relation, visibility: Visibility): boolean {
  return rel.isOwner || (visibility === 'team' && rel.role !== null)
}

export function canCreateInWorkspace(role: Role | null): boolean {
  return role === 'admin' || role === 'member'
}

export function canManageRoles(role: Role | null): boolean {
  return role === 'admin'
}

/** 404 hides existence from anyone who can't see the recipe; 403 means "visible, but not yours to change". */
export function denialStatus(rel: Relation, visibility: Visibility): 403 | 404 {
  return canView(rel, visibility) ? 403 : 404
}

export function decide(action: Action, rel: Relation, visibility: Visibility): Decision {
  if (!canView(rel, visibility)) {
    return {
      allowed: false,
      status: 404,
      reason: rel.role === null ? "People outside the recipe's workspace can't see it" : 'This recipe is private to its owner',
    }
  }
  switch (action) {
    case 'view':
      return { allowed: true, reason: rel.isOwner ? 'You own this recipe' : 'Shared with your workspace' }
    case 'run':
      return { allowed: true, reason: 'Anyone who can see a recipe can run it on their own file' }
    case 'fork':
      return canCreateInWorkspace(rel.role)
        ? { allowed: true, reason: 'Admins and members can make a private copy' }
        : { allowed: false, status: 403, reason: 'Viewers can run recipes but cannot make copies' }
    case 'edit':
      return rel.isOwner
        ? { allowed: true, reason: 'Only the owner saves new versions' }
        : { allowed: false, status: 403, reason: 'Only the owner can save a new version. Make a copy to adapt it.' }
    case 'share':
      return rel.isOwner
        ? { allowed: true, reason: 'Only the owner changes sharing' }
        : { allowed: false, status: 403, reason: 'Only the owner can change who this recipe is shared with' }
  }
}

export function decideAll(rel: Relation, visibility: Visibility): Record<Action, Decision> {
  return {
    view: decide('view', rel, visibility),
    run: decide('run', rel, visibility),
    fork: decide('fork', rel, visibility),
    edit: decide('edit', rel, visibility),
    share: decide('share', rel, visibility),
  }
}

/** Runs are private to the person who ran them, even from the recipe owner and workspace admins. */
export function canReadRun(runnerId: string, callerId: string): boolean {
  return runnerId === callerId
}

/**
 * Admins manage roles only. An admin can't change their own role, and the last
 * admin can't be demoted.
 */
export function decideRoleChange(input: {
  actorId: string
  actorRole: Role | null
  targetId: string
  targetRole: Role
  newRole: Role
  adminCount: number
}): Decision {
  if (input.actorRole === null) return { allowed: false, status: 404, reason: 'You are not a member of this workspace' }
  if (!canManageRoles(input.actorRole)) return { allowed: false, status: 403, reason: 'Only admins can change roles' }
  if (input.actorId === input.targetId) return { allowed: false, status: 403, reason: "You can't change your own role" }
  if (input.targetRole === 'admin' && input.newRole !== 'admin' && input.adminCount <= 1) {
    return { allowed: false, status: 403, reason: "The last admin can't be demoted" }
  }
  return { allowed: true, reason: 'Admins can change other members’ roles' }
}

// ---------------------------------------------------------------------------
// The permission matrix shown on the Access page, generated from decide().
// ---------------------------------------------------------------------------

export const MATRIX_COLUMNS = [
  { key: 'owner', label: 'Owner', rel: { isOwner: true, role: 'member' } },
  { key: 'admin', label: 'Admin', rel: { isOwner: false, role: 'admin' } },
  { key: 'member', label: 'Member', rel: { isOwner: false, role: 'member' } },
  { key: 'viewer', label: 'Viewer', rel: { isOwner: false, role: 'viewer' } },
  { key: 'outsider', label: 'Outsider', rel: { isOwner: false, role: null } },
] as const satisfies ReadonlyArray<{ key: string; label: string; rel: Relation }>

export const MATRIX_ROWS = [
  { key: 'view', label: 'See the recipe', action: 'view' },
  { key: 'run', label: 'Run it on their own file', action: 'run' },
  { key: 'fork', label: 'Make a copy', action: 'fork' },
  { key: 'edit', label: 'Save a new version', action: 'edit' },
  { key: 'share', label: 'Change sharing', action: 'share' },
  { key: 'others_runs', label: "See someone else's runs" },
  { key: 'create', label: 'Create recipes in the workspace' },
  { key: 'roles', label: "Change members' roles" },
] as const

export type MatrixCell = { allowed: boolean; label: string; status?: 403 | 404; reason: string }

function cellFrom(decision: Decision): MatrixCell {
  return decision.allowed
    ? { allowed: true, label: 'Yes', reason: decision.reason }
    : { allowed: false, label: `No (${decision.status})`, status: decision.status, reason: decision.reason }
}

export function permissionMatrix(visibility: Visibility): Array<{ key: string; label: string; cells: MatrixCell[] }> {
  return MATRIX_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    cells: MATRIX_COLUMNS.map(({ key, rel }): MatrixCell => {
      if ('action' in row) return cellFrom(decide(row.action, rel, visibility))
      if (row.key === 'others_runs') {
        return { allowed: false, label: 'No (404)', status: 404, reason: 'Runs are private to the person who ran them' }
      }
      // Workspace-level permissions don't depend on any one recipe.
      if (key === 'owner') return { allowed: false, label: 'n/a', reason: 'Depends on the owner’s role in the workspace' }
      if (rel.role === null) return { allowed: false, label: 'No', reason: 'Outsiders belong to another workspace' }
      const allowed = row.key === 'create' ? canCreateInWorkspace(rel.role) : canManageRoles(rel.role)
      return allowed
        ? { allowed: true, label: 'Yes', reason: row.key === 'create' ? 'Admins and members create recipes' : 'Admins manage roles' }
        : {
            allowed: false,
            label: 'No (403)',
            status: 403,
            reason: row.key === 'create' ? 'Viewers can run recipes but not create them' : 'Only admins change roles',
          }
    }),
  }))
}
