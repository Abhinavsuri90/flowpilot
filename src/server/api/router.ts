import { getDb } from '../db'
import { userFromRequest } from '../auth'
import { loadEnv } from '../env'
import { ApiError, errorResponse, unauthorized } from '../http'
import type { ApiContext, AuthedContext } from './context'
import * as auth from './auth'
import * as workflows from './workflows'
import * as runs from './runs'
import * as workspace from './workspace'
import * as dashboard from './dashboard'
import * as system from './system'
import * as generate from './generate'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type Route = {
  method: Method
  pattern: string
  /** false = anonymous callers allowed (login, logout). */
  auth: boolean
  handler: (ctx: AuthedContext) => Response | Promise<Response>
}

const ROUTES: Route[] = [
  { method: 'POST', pattern: '/api/auth/login', auth: false, handler: auth.login },
  { method: 'POST', pattern: '/api/auth/logout', auth: false, handler: auth.logout },
  { method: 'GET', pattern: '/api/me', auth: true, handler: auth.me },
  { method: 'GET', pattern: '/api/dashboard', auth: true, handler: dashboard.get },
  { method: 'GET', pattern: '/api/workflows', auth: true, handler: workflows.list },
  { method: 'POST', pattern: '/api/workflows', auth: true, handler: workflows.create },
  { method: 'GET', pattern: '/api/workflows/:id', auth: true, handler: workflows.detail },
  { method: 'PATCH', pattern: '/api/workflows/:id', auth: true, handler: workflows.patch },
  { method: 'POST', pattern: '/api/workflows/:id/versions', auth: true, handler: workflows.saveVersion },
  { method: 'POST', pattern: '/api/workflows/:id/fork', auth: true, handler: workflows.fork },
  { method: 'GET', pattern: '/api/workflows/:id/access', auth: true, handler: workflows.access },
  { method: 'POST', pattern: '/api/generate', auth: true, handler: generate.create },
  { method: 'POST', pattern: '/api/runs', auth: true, handler: runs.create },
  { method: 'GET', pattern: '/api/runs', auth: true, handler: runs.list },
  { method: 'DELETE', pattern: '/api/runs', auth: true, handler: runs.remove },
  { method: 'GET', pattern: '/api/runs/:id', auth: true, handler: runs.detail },
  { method: 'GET', pattern: '/api/runs/:id/csv', auth: true, handler: runs.csv },
  { method: 'GET', pattern: '/api/workspace', auth: true, handler: workspace.get },
  { method: 'PATCH', pattern: '/api/workspace/members/:userId', auth: true, handler: workspace.setRole },
  { method: 'GET', pattern: '/api/system', auth: true, handler: (ctx) => system.get(ctx, API_ROUTES) },
]

export const API_ROUTES = ROUTES.map(({ method, pattern, auth }) => ({ method, pattern, auth }))

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
    let originHost: string | null = null
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

/** The single entry point for the REST API. Tests call it directly with real cookies. */
export async function handleApi(request: Request): Promise<Response> {
  loadEnv()
  try {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()
    const candidates = COMPILED.map((route) => ({ route, match: route.regex.exec(url.pathname) })).filter(
      (c) => c.match,
    )
    if (candidates.length === 0) throw new ApiError(404, 'NOT_FOUND', 'No such API endpoint.')
    const hit = candidates.find((c) => c.route.method === method)
    if (!hit) {
      const allow = [...new Set(candidates.map((c) => c.route.method))].join(', ')
      return errorResponse(new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${allow} for this endpoint.`), { Allow: allow })
    }

    if (WRITE_METHODS.has(method)) assertSameOrigin(request)

    const db = getDb()
    const user = userFromRequest(db, request)
    if (hit.route.auth && !user) throw unauthorized()

    const params: Record<string, string> = {}
    hit.route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(hit.match![i + 1]!)
    })
    const ctx: ApiContext = { request, url, params, db, user }
    return await hit.route.handler(ctx as AuthedContext)
  } catch (err) {
    return mapError(err)
  }
}

