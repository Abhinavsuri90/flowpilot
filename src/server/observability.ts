import { randomBytes } from 'node:crypto'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import type { DB } from './db'
import { appConfig } from './config'
import { APP_VERSION } from '../lib/version'

// Operational visibility without dependencies:
// - a request id on every API response (X-Request-Id), in error bodies and in logs;
// - one structured log line per API request (JSON in production, short text in development);
// - Prometheus metrics: counters and histograms kept in memory, gauges read from the
//   database when scraped. Labels are route patterns ("/api/invites/:token"), never raw
//   paths, so link tokens can't reach logs and the number of series stays bounded.

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------

/**
 * An id the proxy in front already assigned is kept, so its logs and ours line up,
 * but only when TRUST_PROXY says there is such a proxy (like forwarded addresses)
 * and the id is safe to log. Anything else gets a fresh id.
 */
const INCOMING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

export function requestIdFor(request: Request): string {
  const incoming = appConfig().trustProxy !== 'off' ? request.headers.get('x-request-id')?.trim() : undefined
  return incoming && INCOMING_ID.test(incoming) ? incoming : `req_${randomBytes(8).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>
type Sink = (line: string, level: LogLevel) => void

const defaultSink: Sink = (line, level) => (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`)
let sink: Sink = defaultSink

/** Tests capture log lines here; null restores standard output. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? defaultSink
}

function serializable(fields: Fields): Fields {
  const out: Fields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  }
  return out
}

/**
 * Writes one log line. Request lines follow LOG_FORMAT (and are skipped when it is
 * "off"); warnings and errors are always written, as JSON when LOG_FORMAT is json.
 */
export function log(level: LogLevel, msg: string, fields: Fields = {}): void {
  const format = appConfig().logFormat
  if (format === 'off' && level === 'info') return
  const data = serializable(fields)
  if (format === 'json') {
    sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...data }), level)
    return
  }
  const { err, ...rest } = data
  const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
  const stack = err && typeof err === 'object' && 'stack' in err ? `\n${String((err as { stack?: string }).stack ?? '')}` : ''
  sink(`[flowpilot] ${level}: ${msg}${detail}${stack}`, level)
}

// ---------------------------------------------------------------------------
// Metrics (Prometheus text exposition format 0.0.4)
// ---------------------------------------------------------------------------

type Labels = Record<string, string>

const escapeLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')

function labelText(labels: Labels): string {
  const keys = Object.keys(labels).sort()
  return keys.length ? `{${keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(',')}}` : ''
}

const number = (value: number) => (Number.isFinite(value) ? String(value) : value > 0 ? '+Inf' : value < 0 ? '-Inf' : 'NaN')

export class Counter {
  private readonly series = new Map<string, { labels: Labels; value: number }>()
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelText(labels)
    const entry = this.series.get(key)
    if (entry) entry.value += by
    else this.series.set(key, { labels, value: by })
  }

  /** The current value of one series (0 when it was never incremented). */
  value(labels: Labels = {}): number {
    return this.series.get(labelText(labels))?.value ?? 0
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const { labels, value } of this.series.values()) lines.push(`${this.name}${labelText(labels)} ${number(value)}`)
    return lines
  }

  reset(): void {
    this.series.clear()
  }
}

export class Histogram {
  private readonly series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>()
  constructor(
    readonly name: string,
    readonly help: string,
    /** Upper bounds in seconds, ascending; +Inf is implied. */
    readonly buckets: readonly number[],
  ) {}

  observe(labels: Labels, value: number): void {
    const key = labelText(labels)
    let entry = this.series.get(key)
    if (!entry) {
      entry = { labels, counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 }
      this.series.set(key, entry)
    }
    const index = this.buckets.findIndex((bound) => value <= bound)
    if (index !== -1) entry.counts[index]! += 1
    entry.sum += value
    entry.count += 1
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    for (const { labels, counts, sum, count } of this.series.values()) {
      let cumulative = 0
      this.buckets.forEach((bound, i) => {
        cumulative += counts[i]!
        lines.push(`${this.name}_bucket${labelText({ ...labels, le: number(bound) })} ${cumulative}`)
      })
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: '+Inf' })} ${count}`)
      lines.push(`${this.name}_sum${labelText(labels)} ${number(sum)}`)
      lines.push(`${this.name}_count${labelText(labels)} ${count}`)
    }
    return lines
  }

  reset(): void {
    this.series.clear()
  }
}

const REQUEST_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

/** Everything the server counts as it works. */
export const metrics = {
  httpRequests: new Counter('flowpilot_http_requests_total', 'API requests answered, by method, route pattern and status code.'),
  httpDuration: new Histogram('flowpilot_http_request_duration_seconds', 'Time to answer an API request, by method and route pattern.', REQUEST_BUCKETS),
  runs: new Counter('flowpilot_recipe_runs_total', 'Recipe runs finished, by status.'),
  runDuration: new Histogram('flowpilot_recipe_run_duration_seconds', 'Time to execute a run and store its result.', [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 30]),
  drafts: new Counter('flowpilot_ai_drafts_total', 'AI drafting requests sent to the model, by outcome (workflow, clarification, unsupported, error).'),
  draftDuration: new Histogram('flowpilot_ai_draft_duration_seconds', 'Time the model took to answer a drafting request.', [0.5, 1, 2, 3, 5, 8, 13, 21, 34]),
  signIns: new Counter('flowpilot_sign_ins_total', 'Sign-in attempts with a password, by outcome (success, second_step, invalid, throttled).'),
  secondFactor: new Counter('flowpilot_two_factor_checks_total', 'Codes checked at the second step of signing in, by outcome (totp, recovery, invalid, expired, throttled).'),
}

export function resetMetrics(): void {
  for (const metric of Object.values(metrics)) metric.reset()
}

const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** Records one answered API request: a metric sample and, unless logging is off, a log line. */
export function observeRequest(entry: {
  requestId: string
  method: string
  route: string | null
  status: number
  durationMs: number
  user: { id: string; via: 'session' | 'token' } | null
}): void {
  // A client can send any method name; only known ones become label values.
  const method = KNOWN_METHODS.has(entry.method) ? entry.method : 'OTHER'
  const route = entry.route ?? 'unmatched'
  metrics.httpRequests.inc({ method, route, status: String(entry.status) })
  metrics.httpDuration.observe({ method, route }, entry.durationMs / 1000)
  if (appConfig().logFormat === 'off') return
  if (appConfig().logFormat === 'pretty') {
    log('info', `${method} ${route} → ${entry.status} in ${entry.durationMs.toFixed(1)} ms`, { requestId: entry.requestId })
    return
  }
  log('info', 'request', {
    requestId: entry.requestId,
    method,
    route,
    status: entry.status,
    durationMs: Math.round(entry.durationMs * 10) / 10,
    userId: entry.user?.id,
    via: entry.user?.via ?? 'anonymous',
  })
}

// Event-loop lag shows when synchronous work (a large run, a CPU-heavy parse)
// holds up every other request. Node records the time between samples, so the
// sampling interval is subtracted to leave the lag itself. Reset on each scrape.
const LOOP_RESOLUTION_MS = 20
let loopDelay: IntervalHistogram | null = null

export function startRuntimeMonitors(): void {
  if (loopDelay || process.env.VITEST) return
  loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })
  loopDelay.enable()
}

const lagSeconds = (nanoseconds: number) => Math.max(0, nanoseconds / 1e9 - LOOP_RESOLUTION_MS / 1000)

function gauge(name: string, help: string, samples: Array<{ labels?: Labels; value: number }>): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, ...samples.map((s) => `${name}${labelText(s.labels ?? {})} ${number(s.value)}`)]
}

/** The full scrape: live counters, then what the database and the process look like right now. */
export function renderMetrics(db: DB, now = Date.now()): string {
  const count = (sql: string, ...args: unknown[]) => db.prepare(sql).pluck().get(...args) as number
  const at = new Date(now).toISOString()
  const runsByStatus = db.prepare('SELECT status, COUNT(*) AS n FROM runs GROUP BY status').all() as Array<{ status: string; n: number }>
  const memory = process.memoryUsage()

  const lines: string[] = []
  for (const metric of Object.values(metrics)) lines.push(...metric.render())
  lines.push(
    ...gauge('flowpilot_users', 'Accounts.', [{ value: count('SELECT COUNT(*) FROM users') }]),
    ...gauge('flowpilot_two_factor_users', 'Accounts with two-step sign-in on.', [{ value: count('SELECT COUNT(*) FROM users WHERE totp_enabled_at IS NOT NULL') }]),
    ...gauge('flowpilot_workspaces', 'Workspaces.', [{ value: count('SELECT COUNT(*) FROM workspaces') }]),
    ...gauge('flowpilot_recipes', 'Recipes, by state.', [
      { labels: { state: 'active' }, value: count('SELECT COUNT(*) FROM workflows WHERE archived_at IS NULL') },
      { labels: { state: 'archived' }, value: count('SELECT COUNT(*) FROM workflows WHERE archived_at IS NOT NULL') },
    ]),
    ...gauge('flowpilot_recipe_versions', 'Saved recipe versions (immutable).', [{ value: count('SELECT COUNT(*) FROM workflow_versions') }]),
    ...gauge(
      'flowpilot_runs_stored',
      'Run records kept, by status.',
      ['running', 'succeeded', 'failed'].map((status) => ({ labels: { status }, value: runsByStatus.find((r) => r.status === status)?.n ?? 0 })),
    ),
    ...gauge('flowpilot_sessions_active', 'Unexpired browser sessions.', [{ value: count('SELECT COUNT(*) FROM sessions WHERE expires_at > ?', at) }]),
    ...gauge('flowpilot_api_tokens_active', 'Unrevoked, unexpired personal API tokens.', [
      { value: count('SELECT COUNT(*) FROM api_tokens WHERE revoked_at IS NULL AND expires_at > ?', at) },
    ]),
    ...gauge('flowpilot_process_resident_memory_bytes', 'Resident memory of the server process.', [{ value: memory.rss }]),
    ...gauge('flowpilot_process_heap_used_bytes', 'JavaScript heap in use.', [{ value: memory.heapUsed }]),
    ...gauge('flowpilot_process_uptime_seconds', 'Seconds since the server process started.', [{ value: Math.round(process.uptime()) }]),
  )
  if (loopDelay && loopDelay.count > 0) {
    lines.push(
      ...gauge('flowpilot_event_loop_lag_seconds', 'How late the event loop ran timers since the previous scrape (0 = never blocked).', [
        { labels: { quantile: '0.5' }, value: lagSeconds(loopDelay.percentile(50)) },
        { labels: { quantile: '0.99' }, value: lagSeconds(loopDelay.percentile(99)) },
        { labels: { quantile: '1' }, value: lagSeconds(loopDelay.max) },
      ]),
    )
    loopDelay.reset()
  }
  lines.push(...gauge('flowpilot_build_info', 'Always 1; the labels say what is running.', [{ labels: { version: APP_VERSION, node: process.version }, value: 1 }]))
  return `${lines.join('\n')}\n`
}
