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
  provider: 'anthropic' | 'openai' | null
  model: string | null
}

/** The signed-in user, as the app shell and GET /api/me see them. */
export type Me = {
  user: { id: string; email: string; name: string; hue: number }
  memberships: Membership[]
  /** The workspace new recipes are created in (first membership). */
  workspace: Membership | null
  model: ModelStatus
}

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
}

export type WorkflowList = { items: WorkflowSummary[]; counts: { mine: number; team: number } }

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
}

export type WorkspaceInfo = {
  workspace: { id: string; name: string }
  role: Role
  members: WorkspaceMember[]
  canManageRoles: boolean
  adminCount: number
}

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
  checklist: { created: boolean; ran: boolean; shared: boolean; copied: boolean }
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
