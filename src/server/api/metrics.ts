import { createHash, timingSafeEqual } from 'node:crypto'
import { appConfig } from '../config'
import { ApiError, NO_STORE } from '../http'
import { renderMetrics } from '../observability'
import type { ApiContext } from './context'

/** Constant-time comparison of two secrets of any length (their digests have equal length). */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/**
 * GET /api/metrics: Prometheus metrics for whoever runs the server. It exists only
 * when METRICS_TOKEN is set (otherwise 404, like any unknown path), and the scraper
 * sends that token as a bearer token. Counts only: no names, emails or recipe data.
 */
export function get({ db, request }: ApiContext): Response {
  const token = appConfig().metricsToken
  if (!token) throw new ApiError(404, 'NOT_FOUND', 'No such API endpoint.')
  const given = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1] ?? ''
  if (!sameSecret(given, token)) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Send the metrics token as "Authorization: Bearer <METRICS_TOKEN>".', {
      headers: { 'WWW-Authenticate': 'Bearer realm="metrics"' },
    })
  }
  return new Response(renderMetrics(db), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
