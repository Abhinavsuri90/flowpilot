import type { ApiIssue } from './types'

/** An API failure with the server's structured error attached. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly issues: ApiIssue[]
  readonly draft?: unknown
  readonly runId?: string

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { issues?: ApiIssue[]; draft?: unknown; runId?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = extra.issues ?? []
    this.draft = extra.draft
    this.runId = extra.runId
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.')
  }
  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; issues?: ApiIssue[]; draft?: unknown; runId?: string } })
      ?.error
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status}).`, {
      issues: err?.issues,
      draft: err?.draft,
      runId: err?.runId,
    })
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
}

/** Query keys. Everything private is keyed under the signed-in user's cache, which is cleared on sign-in/out. */
export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  workflows: (scope: string, q: string) => ['workflows', scope, q] as const,
  workflowsAll: ['workflows'] as const,
  workflow: (id: string, v?: string) => ['workflow', id, v ?? 'current'] as const,
  workflowAll: (id: string) => ['workflow', id] as const,
  access: (id: string) => ['access', id] as const,
  runs: (workflowId?: string) => ['runs', workflowId ?? 'all'] as const,
  runsAll: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
  workspace: ['workspace'] as const,
  system: ['system'] as const,
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}
