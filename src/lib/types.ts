// Types shared by the API handlers and the browser.

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
