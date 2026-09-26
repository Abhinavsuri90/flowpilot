import { getDb } from '../db'
import { userFromRequest } from '../auth'
import { loadEnv } from '../env'
import { ensureReady } from '../boot'
import { ApiError, HSTS, errorResponse, isSecureRequest, json, noContent, unauthorized } from '../http'
import type { ApiContext, AuthedContext } from './context'
import * as auth from './auth'
import * as workflows from './workflows'
import * as runs from './runs'
import * as workspace from './workspace'
import * as dashboard from './dashboard'
import * as system from './system'
import * as generate from './generate'
import * as account from './account'
import * as invites from './invites'
import * as audit from './audit'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type Route = {
  method: Method
  pattern: string
  /** false = anonymous callers allowed (login, logout); 'session' = a browser session only, never an API token (account and security settings). */
  auth: boolean | 'session'
  handler: (ctx: AuthedContext) => Response | Promise<Response>
}

const ROUTES: Route[] = [
  { method: 'POST', pattern: '/api/auth/login', auth: false, handler: auth.login },
  { method: 'POST', pattern: '/api/auth/logout', auth: false, handler: auth.logout },
  { method: 'POST', pattern: '/api/auth/register', auth: false, handler: account.register },
  { method: 'POST', pattern: '/api/auth/forgot', auth: false, handler: account.forgotPassword },
  { method: 'GET', pattern: '/api/auth/reset/:token', auth: false, handler: account.resetInfo },
  { method: 'POST', pattern: '/api/auth/reset', auth: false, handler: account.resetPassword },
  { method: 'GET', pattern: '/api/me', auth: true, handler: auth.me },
  { method: 'PATCH', pattern: '/api/me', auth: 'session', handler: account.updateMe },
  { method: 'POST', pattern: '/api/me/password', auth: 'session', handler: account.changePassword },
  { method: 'GET', pattern: '/api/me/sessions', auth: 'session', handler: account.sessions },
  { method: 'DELETE', pattern: '/api/me/sessions', auth: 'session', handler: account.signOutOthers },
  { method: 'POST', pattern: '/api/me/workspace', auth: 'session', handler: account.switchWorkspace },
  { method: 'GET', pattern: '/api/me/tokens', auth: 'session', handler: account.tokens },
  { method: 'POST', pattern: '/api/me/tokens', auth: 'session', handler: account.createToken },
  { method: 'DELETE', pattern: '/api/me/tokens/:id', auth: 'session', handler: account.revokeToken },
  { method: 'POST', pattern: '/api/workspaces', auth: 'session', handler: account.createWorkspaceHandler },
  { method: 'GET', pattern: '/api/health', auth: false, handler: ({ db }) => json({ status: db.prepare('SELECT 1').pluck().get() === 1 ? 'ok' : 'degraded' }) },
  { method: 'GET', pattern: '/api/dashboard', auth: true, handler: dashboard.get },
  { method: 'GET', pattern: '/api/workflows', auth: true, handler: workflows.list },
  { method: 'POST', pattern: '/api/workflows', auth: true, handler: workflows.create },
  { method: 'GET', pattern: '/api/workflows/:id', auth: true, handler: workflows.detail },
  { method: 'PATCH', pattern: '/api/workflows/:id', auth: true, handler: workflows.patch },
  { method: 'POST', pattern: '/api/workflows/:id/versions', auth: true, handler: workflows.saveVersion },
  { method: 'POST', pattern: '/api/workflows/:id/fork', auth: true, handler: workflows.fork },
  { method: 'GET', pattern: '/api/workflows/:id/access', auth: true, handler: workflows.access },
  { method: 'POST', pattern: '/api/workflows/:id/transfer', auth: true, handler: workflows.transfer },
  { method: 'POST', pattern: '/api/generate', auth: true, handler: generate.create },
  { method: 'POST', pattern: '/api/runs', auth: true, handler: runs.create },
  { method: 'GET', pattern: '/api/runs', auth: true, handler: runs.list },
  { method: 'DELETE', pattern: '/api/runs', auth: true, handler: runs.remove },
  { method: 'GET', pattern: '/api/runs/:id', auth: true, handler: runs.detail },
  { method: 'GET', pattern: '/api/runs/:id/csv', auth: true, handler: runs.csv },
  { method: 'GET', pattern: '/api/workspace', auth: true, handler: workspace.get },
  { method: 'PATCH', pattern: '/api/workspace', auth: 'session', handler: workspace.rename },
  { method: 'POST', pattern: '/api/workspace/leave', auth: 'session', handler: workspace.leave },
  { method: 'PATCH', pattern: '/api/workspace/members/:userId', auth: 'session', handler: workspace.setRole },
  { method: 'DELETE', pattern: '/api/workspace/members/:userId', auth: 'session', handler: workspace.removeMember },
  { method: 'GET', pattern: '/api/workspace/audit', auth: true, handler: audit.list },
  { method: 'GET', pattern: '/api/workspace/audit.csv', auth: true, handler: audit.csv },
  { method: 'GET', pattern: '/api/workspace/invites', auth: 'session', handler: invites.list },
  { method: 'POST', pattern: '/api/workspace/invites', auth: 'session', handler: invites.create },
  { method: 'DELETE', pattern: '/api/workspace/invites/:id', auth: 'session', handler: invites.revoke },
  { method: 'GET', pattern: '/api/invites/:token', auth: false, handler: invites.info },
  { method: 'POST', pattern: '/api/invites/:token/accept', auth: 'session', handler: invites.accept },
  { method: 'GET', pattern: '/api/system', auth: true, handler: (ctx) => system.get(ctx, API_ROUTES) },
]

export const API_ROUTES = ROUTES.map(({ method, pattern, auth }) => ({ method, pattern, auth: auth !== false }))

type CompiledRoute = Route & { regex: RegExp; keys: string[] }

const COMPILED: CompiledRoute[] = ROUTES.map((route) => {
  const keys: string[] = []
  const source = route.pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      keys.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { ...route, regex: new RegExp(`^${source}/?$`), keys }
})

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Blocks cross-site writes: the Origin host must equal the Host (or
 * X-Forwarded-Host). Requests without an Origin are allowed unless the browser
 * says they came from another site.
 */
function assertSameOrigin(request: Request): void {
  const allowed = new Set<string>([new URL(request.url).host])
  const host = request.headers.get('host')
  if (host) allowed.add(host)
  const forwarded = request.headers.get('x-forwarded-host')
  if (forwarded) allowed.add(forwarded.split(',')[0]!.trim())

  const origin = request.headers.get('origin')
  if (origin) {
    let originHost: string | null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (!originHost || !allowed.has(originHost)) throw badOrigin()
    return
  }
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw badOrigin()
}

const badOrigin = () => new ApiError(403, 'BAD_ORIGIN', 'Cross-site requests are not allowed.')

function mapError(err: unknown): Response {
  if (err instanceof ApiError) return errorResponse(err)
  const code = (err as { code?: string } | null)?.code
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    // A database invariant (trigger or CHECK) rejected the write.
    console.warn('[flowpilot] constraint rejected a write:', (err as Error).message)
    return errorResponse(new ApiError(409, 'CONFLICT', (err as Error).message))
  }
  console.error('[flowpilot] unexpected API error', err)
  return errorResponse(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on the server. Please try again.'))
}

/** Methods a path answers to: its routes, plus HEAD wherever GET works (RFC 9110) and OPTIONS. */
function allowedMethods(candidates: CompiledRoute[]): string {
  const methods = new Set<string>(candidates.map((route) => route.method))
  if (methods.has('GET')) methods.add('HEAD')
  methods.add('OPTIONS')
  return [...methods].join(', ')
}

/** Path parameters, or null when one isn't valid percent-encoding (such an id can't exist). */
function pathParams(keys: string[], match: RegExpExecArray): Record<string, string> | null {
  const params: Record<string, string> = {}
  try {
    keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1]!)
    })
  } catch {
    return null
  }
  return params
}

/** The single entry point for the REST API. Tests call it directly with real cookies. */
export async function handleApi(request: Request): Promise<Response> {
  loadEnv()
  await ensureReady()
  const isHead = request.method.toUpperCase() === 'HEAD'
  const response = await dispatch(request, isHead ? 'GET' : request.method.toUpperCase())
  if (isSecureRequest(request)) response.headers.set('Strict-Transport-Security', HSTS)
  // HEAD: the GET response's status and headers, without the body.
  return isHead ? new Response(null, { status: response.status, headers: response.headers }) : response
}

async function dispatch(request: Request, method: string): Promise<Response> {
  try {
    const url = new URL(request.url)
    const candidates = COMPILED.map((route) => ({ route, match: route.regex.exec(url.pathname) })).filter(
      (c) => c.match,
    )
    if (candidates.length === 0) throw new ApiError(404, 'NOT_FOUND', 'No such API endpoint.')
    const allow = allowedMethods(candidates.map((c) => c.route))
    if (method === 'OPTIONS') return noContent({ Allow: allow })
    const hit = candidates.find((c) => c.route.method === method)
    if (!hit) {
      return errorResponse(new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${allow.replace(/, OPTIONS$/, '')} for this endpoint.`), { Allow: allow })
    }

    if (WRITE_METHODS.has(method)) assertSameOrigin(request)

    const params = pathParams(hit.route.keys, hit.match!)
    if (!params) throw new ApiError(404, 'NOT_FOUND', "That item doesn't exist or you don't have access to it.")

    const db = getDb()
    const user = userFromRequest(db, request)
    if (hit.route.auth && !user) throw unauthorized()
    if (hit.route.auth === 'session' && user?.via === 'token') {
      throw new ApiError(403, 'SESSION_REQUIRED', 'Sign in in a browser to change account, security or membership settings; API tokens can’t.')
    }

    const ctx: ApiContext = { request, url, params, db, user }
    return await hit.route.handler(ctx as AuthedContext)
  } catch (err) {
    return mapError(err)
  }
}

