import { forbidden, json, notFound, NO_STORE } from '../http'
import { currentMembership } from '../auth'
import { AUDIT_CATEGORIES, listAudit, type AuditCategory } from '../events'
import { toCsv } from '../../lib/csv'
import type { AuthedContext } from './context'

function adminWorkspace(ctx: AuthedContext) {
  const membership = currentMembership(ctx.user)
  if (!membership) throw notFound('That workspace')
  if (membership.role !== 'admin') throw forbidden('Only admins can read the audit log')
  return membership
}

function filters(url: URL) {
  const category = url.searchParams.get('category')
  const before = url.searchParams.get('before')
  const limit = url.searchParams.get('limit')
  return {
    category: category && category in AUDIT_CATEGORIES ? (category as AuditCategory) : undefined,
    actorId: url.searchParams.get('actor') || undefined,
    before: before && /^\d{1,15}$/.test(before) ? Number(before) : undefined,
    limit: limit && /^\d{1,4}$/.test(limit) ? Math.min(Number(limit), 200) : 50,
  }
}

/** GET /api/workspace/audit: newest first, filterable, paged with ?before=<id>. Admins only. */
export function list(ctx: AuthedContext): Response {
  const membership = adminWorkspace(ctx)
  return json(listAudit(ctx.db, ctx.user, membership.workspaceId, filters(ctx.url)))
}

/** GET /api/workspace/audit.csv: the same log (up to 10,000 entries) as a formula-safe CSV. */
export function csv(ctx: AuthedContext): Response {
  const membership = adminWorkspace(ctx)
  const { entries } = listAudit(ctx.db, ctx.user, membership.workspaceId, { ...filters(ctx.url), before: undefined, limit: 10_000 })
  const body = toCsv(
    ['time_utc', 'actor', 'category', 'action', 'description', 'recipe_id'],
    entries.map((e) => ({ time_utc: e.at, actor: e.actor.name, category: e.category, action: e.action, description: e.text, recipe_id: e.recipe?.id ?? '' })),
  )
  const slug = membership.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
