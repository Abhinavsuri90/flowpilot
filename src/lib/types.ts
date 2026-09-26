// Types shared by the API handlers and the browser.

import type { Column, ColumnType, Row, StepLogEntry, WorkflowDefinition } from './workflow/schema'
import type { MatrixCell } from './policy'

export type Role = 'admin' | 'member' | 'viewer'
export type Visibility = 'private' | 'team'
export type RunStatus = 'running' | 'succeeded' | 'failed'
export type Action = 'view' | 'run' | 'fork' | 'edit' | 'share'

/** One problem, pinned to a step, a CSV line, or a field path. */
export type ApiIssue = {
  path: string
  message: string
  stepId?: string
  stepIndex?: number
  line?: number
  column?: string
}

export type ApiErrorBody = {
  error: { code: string; message: string; issues?: ApiIssue[]; draft?: unknown; runId?: string }
}

export type Membership = { workspaceId: string; workspaceName: string; role: Role }

export type UserRef = { id: string; name: string; hue: number }

export type ModelStatus = {
  available: boolean
  provider: 'anthropic' | 'openai' | 'openrouter' | null
  model: string | null
}

/** The signed-in user, as the app shell and GET /api/me see them. */
export type Me = {
  user: { id: string; email: string; name: string; hue: number; isDemo: boolean }
  memberships: Membership[]
  /** The workspace this browser works in: lists, new recipes and the Access page use it. */
  workspace: Membership | null
  model: ModelStatus
}

export type RegistrationMode = 'open' | 'invite-only' | 'closed'

/** What the sign-in and sign-up pages need to know about this server. */
export type AuthOptions = {
  demoMode: boolean
  /** Filled only when the demo accounts use the documented demo password. */
  demoPassword: string | null
  registration: RegistrationMode
  /** Whether emails (reset links, invites) are really sent. */
  mail: boolean
}

export type InviteInfo = {
  id: string
  role: Role
  email: string | null
  createdBy: UserRef
  createdAt: string
  expiresAt: string
  uses: number
  maxUses: number
}

/** GET /api/invites/:token: what someone opening an invite link sees. */
export type InviteLanding = {
  workspace: { name: string }
  invitedBy: string
  invitedByHue: number
  role: Role
  email: string | null
  expiresAt: string
  /** Only when signed in. */
  viewer: { alreadyMember: boolean; emailMatches: boolean } | null
}

export type SessionInfo = { id: string; current: boolean; createdAt: string; lastSeenAt: string | null; device: string }

/** A personal API token as listed on the account page (never the secret itself). */
export type ApiTokenInfo = { id: string; name: string; prefix: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; expired: boolean }

// ----- Recipes ---------------------------------------------------------------


/** Where a copy came from. Hidden once the caller can no longer see the source. */
export type Attribution =
  | { kind: 'visible'; workflowId: string; title: string; owner: UserRef; versionId: string; versionNumber: number }
  | { kind: 'hidden'; versionNumber: number }

export type WorkflowSummary = {
  id: string
  title: string
  description: string
  visibility: Visibility
  isExample: boolean
  isMine: boolean
  owner: UserRef
  workspace: { id: string; name: string }
  currentVersion: { id: string; number: number }
  requiredColumns: Array<{ name: string; type: ColumnType }>
  stepCount: number
  parameterNames: string[]
  forkedFrom: Attribution | null
  canFork: boolean
  createdAt: string
  updatedAt: string
  /** When the owner archived it (null = active). Archived recipes can't be run, copied or edited until restored. */
  archivedAt: string | null
}

export type WorkflowList = {
  items: WorkflowSummary[]
  counts: { mine: number; team: number; archived: number }
  /** Recipes matching this scope and search (items holds one page of them). */
  total: number
  /** Offset of the next page, or null when this was the last. */
  nextOffset: number | null
}

export type PermissionInfo = { allowed: boolean; reason: string; status?: 403 | 404 }

export type VersionInfo = { id: string; number: number; createdAt: string; createdBy: UserRef }

export type WorkflowDetail = {
  workflow: WorkflowSummary
  version: VersionInfo & { definition: WorkflowDefinition; isLatest: boolean }
  versions: VersionInfo[]
  latestVersionNumber: number
  permissions: Record<Action, PermissionInfo>
  role: Role | null
  isOwner: boolean
  /** Only the owner sees how many copies were made (never who made them or what they are). */
  forkCount: number | null
}

export type AccessMember = {
  user: UserRef
  role: Role
  isOwner: boolean
  isYou: boolean
  can: Record<Action, boolean>
}

export type WorkflowAccess = {
  workflowId: string
  visibility: Visibility
  workspace: { id: string; name: string }
  members: AccessMember[]
}

// ----- Runs ------------------------------------------------------------------

export type RunSummary = {
  id: string
  status: RunStatus
  workflowId: string
  /** Null when the caller can no longer see the recipe (the run itself stays theirs). */
  workflowTitle: string | null
  recipeAvailable: boolean
  versionId: string
  versionNumber: number
  parameters: Record<string, string | number>
  /** The parameters as people read them for this recipe ("threshold ₹50,000, top_n 3"); empty when none. */
  parametersText: string
  inputName: string | null
  inputRows: number | null
  rowCount: number | null
  summary: string | null
  durationMs: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  finishedAt: string | null
}

/** GET /api/runs: one page of the caller's runs, plus exact counts per status. */
export type RunList = { runs: RunSummary[]; counts: Record<RunStatus | 'all', number> }

export type RunDetail = RunSummary & {
  columns: Column[]
  rows: Row[]
  stepLog: StepLogEntry[]
  ignoredColumns: string[]
}

// ----- Workspace, dashboard, system -----------------------------------------------

export type WorkspaceMember = {
  user: UserRef & { email: string }
  role: Role
  joinedAt: string
  isYou: boolean
  /** Shared demo accounts can't be removed. */
  isDemo: boolean
  /** Recipes they own here (they move to whoever removes them). */
  recipeCount: number
}

export type WorkspaceInfo = {
  workspace: { id: string; name: string }
  role: Role
  members: WorkspaceMember[]
  canManageRoles: boolean
  /** Invite and remove people, rename the workspace (admins). */
  canManageMembers: boolean
  adminCount: number
}

export type AuditCategory = 'recipes' | 'sharing' | 'people' | 'invites' | 'workspace'

/** One line of the admin audit log (runs are never listed; private recipes stay unnamed). */
export type AuditEntry = {
  id: number
  at: string
  actor: UserRef
  category: AuditCategory
  action: string
  text: string
  recipe: { id: string; title: string } | null
}

export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null }

export type ActivityItem = {
  id: number
  type: string
  createdAt: string
  actor: UserRef
  isYou: boolean
  text: string
  workflowId: string | null
  runId: string | null
}

export type Dashboard = {
  stats: {
    myRecipes: number
    sharedByMe: number
    teamRecipes: number
    myRuns7d: number
    succeeded7d: number
    copiesOfMine: number
  }
  runsByDay: Array<{ date: string; succeeded: number; failed: number }>
  recentRuns: RunSummary[]
  activity: ActivityItem[]
  model: ModelStatus
  checklist: { created: boolean; ran: boolean; shared: boolean; copied: boolean; invited: boolean }
}

export type SystemInfo = {
  tables: Array<{
    name: string
    columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean; defaultValue: string | null }>
  }>
  triggers: Array<{ name: string; table: string }>
  indexes: Array<{ name: string; table: string }>
  migrations: Array<{ id: number; name: string; appliedAt: string }>
  limits: Record<string, number>
  model: ModelStatus
  runtime: { node: string; sqlite: string; journalMode: string; foreignKeys: boolean }
  endpoints: Array<{ method: string; pattern: string; auth: boolean }>
}

export type AccessMatrix = Array<{ key: string; label: string; cells: MatrixCell[] }>

export type GenerateResult =
  | { kind: 'workflow'; definition: WorkflowDefinition; provider: string; model: string; repaired: boolean }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'clarification'; question: string }
